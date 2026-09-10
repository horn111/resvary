import OpenAI from 'openai';
import { OpenAIProvider } from '@openai/agents';

export type AiProvider = 'openai' | 'hyperbolic' | 'nous';
export type AiRole = 'agent' | 'analysis';
type Environment = Record<string, string | undefined>;

/** Safe to persist with a job: no keys, URLs or user-supplied provider settings. */
export type AiConfig = Readonly<{
  provider: AiProvider;
  model: string;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}>;

const endpoints: Record<AiProvider, string> = {
  openai: 'https://api.openai.com/v1',
  hyperbolic: 'https://api.hyperbolic.xyz/v1',
  nous: 'https://inference-api.nousresearch.com/v1',
};
// Reviewed, bounded profiles. Nous rates use undiscounted catalog prices observed
// 2026-09-10, so an account discount is never needed to stay inside the budget.
const profiles: Record<AiProvider, Record<string, readonly [number, number]>> = {
  openai: { 'gpt-4.1-mini': [0.4, 1.6] },
  hyperbolic: {
    'meta-llama/Llama-3.3-70B-Instruct': [0.4, 0.4],
    'Qwen/Qwen3-Coder-480B-A35B-Instruct': [0.4, 0.4],
  },
  nous: {
    'qwen/qwen3.8-flash': [0.15, 0.47],
    'openai/gpt-4.1-mini': [0.4, 1.6],
  },
};
const defaults: Record<AiProvider, string> = {
  openai: 'gpt-4.1-mini',
  hyperbolic: 'meta-llama/Llama-3.3-70B-Instruct',
  nous: 'qwen/qwen3.8-flash',
};

export class ProviderRejected extends Error {}
export class ProviderOutcomeUnknown extends Error {}

function apiKey(provider: AiProvider, env: Environment) {
  const primary = `${provider.toUpperCase()}_API_KEY`;
  const value = (env[primary] || (provider !== 'openai' ? env[provider.toUpperCase()] : ''))?.trim();
  if (!value) throw new ProviderRejected(`Missing ${primary}`);
  return value;
}

export function resolveAiConfig(role: AiRole, env: Environment = process.env): AiConfig {
  const providerName = env[`AGENT_DEMO_${role.toUpperCase()}_PROVIDER`] ?? env.AGENT_DEMO_AI_PROVIDER ?? 'openai';
  if (!Object.hasOwn(profiles, providerName)) throw new ProviderRejected('Unsupported AI provider');
  const provider = providerName as AiProvider;
  const model = env[`AGENT_DEMO_${role.toUpperCase()}_MODEL`] ?? defaults[provider];
  const tariff = Object.hasOwn(profiles[provider], model) ? profiles[provider][model] : undefined;
  if (!tariff) throw new ProviderRejected('AI model is not in the reviewed budget profiles');
  return Object.freeze({ provider, model, inputUsdPerMillion: tariff[0], outputUsdPerMillion: tariff[1] });
}

export function validateAiConfig(value: AiConfig): AiConfig {
  const provider = Object.hasOwn(profiles, value.provider) ? profiles[value.provider] : undefined;
  const tariff = provider && Object.hasOwn(provider, value.model) ? provider[value.model] : undefined;
  if (!tariff || value.inputUsdPerMillion !== tariff[0] || value.outputUsdPerMillion !== tariff[1])
    throw new ProviderRejected('Invalid or unreviewed AI model snapshot');
  return Object.freeze({ provider: value.provider, model: value.model,
    inputUsdPerMillion: tariff[0], outputUsdPerMillion: tariff[1] });
}

export function aiReadiness(env: Environment = process.env) {
  try {
    const agent = resolveAiConfig('agent', env), analysis = resolveAiConfig('analysis', env);
    apiKey(agent.provider, env);
    apiKey(analysis.provider, env);
    return { ready: true as const, agent, analysis };
  } catch (error) {
    return { ready: false as const, reason: error instanceof ProviderRejected ? error.message : 'Invalid AI configuration' };
  }
}

function tokenCount(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new ProviderOutcomeUnknown('Provider returned missing or invalid token usage');
  return value;
}

export function normalizeAiUsage(usage: unknown, protocol: 'chat' | 'responses' = 'chat') {
  if (!usage || typeof usage !== 'object') throw new ProviderOutcomeUnknown('Provider usage is missing');
  const data = usage as Record<string, unknown>;
  const input = tokenCount(data[protocol === 'chat' ? 'prompt_tokens' : 'input_tokens']);
  const output = tokenCount(data[protocol === 'chat' ? 'completion_tokens' : 'output_tokens']);
  return { input_tokens: String(input), output_tokens: String(output) };
}

export function costUnits(config: AiConfig, inputTokens: number, outputTokens: number) {
  const checked = validateAiConfig(config);
  return Math.ceil(tokenCount(inputTokens) * checked.inputUsdPerMillion + tokenCount(outputTokens) * checked.outputUsdPerMillion);
}

/** USD micro-units. Includes framing beyond the enforced request-byte limit. */
export function conservativeRunBudgetUnits(agent: AiConfig, analysis: AiConfig) {
  return 8 * costUnits(agent, 17_024, 512) + costUnits(analysis, 17_024, 1_024);
}

type ClientOptions = {
  env?: Environment;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  maxRequestBytes?: number;
  maxOutputTokens?: number;
};

/** The transport refuses redirects, extra requests, streaming and expanded limits. */
export function createAiClient(config: AiConfig, options: ClientOptions = {}) {
  const checked = validateAiConfig(config);
  const baseURL = endpoints[checked.provider];
  const transport = options.fetch ?? globalThis.fetch;
  const maxRequestBytes = options.maxRequestBytes ?? 16_000;
  const maxOutputTokens = options.maxOutputTokens ?? 1_024;
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1 || maxRequestBytes > 16_000 ||
      !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 1_024)
    throw new ProviderRejected('Invalid AI transport limits');
  const protocol = checked.provider === 'openai' ? 'responses' : 'chat/completions';
  return new OpenAI({
    apiKey: apiKey(checked.provider, options.env ?? process.env), baseURL,
    maxRetries: 0, timeout: 60_000,
    fetch: async (url, init) => {
      const destination = url instanceof Request ? url.url : String(url);
      if (destination !== `${baseURL}/${protocol}` || init?.method !== 'POST' || typeof init.body !== 'string')
        throw new ProviderRejected('Unexpected AI transport request');
      if (Buffer.byteLength(init.body) > maxRequestBytes) throw new ProviderRejected('AI input exceeds budget envelope');
      const body = JSON.parse(init.body) as Record<string, unknown>;
      const cap = body.max_tokens ?? body.max_output_tokens;
      if (body.model !== checked.model || typeof cap !== 'number' || !Number.isInteger(cap) || cap < 1 || cap > maxOutputTokens || body.stream === true || (body.n !== undefined && body.n !== 1))
        throw new ProviderRejected('AI request exceeds reviewed model limits');
      if (checked.provider === 'nous' && checked.model.startsWith('qwen/')) {
        // Count every billed completion token; disable optional hidden reasoning.
        body.reasoning = { enabled: false };
      }
      const outgoingBody = JSON.stringify(body);
      if (Buffer.byteLength(outgoingBody) > maxRequestBytes) throw new ProviderRejected('AI input exceeds budget envelope');
      const signals = [options.signal, init.signal].filter((signal): signal is AbortSignal => !!signal);
      const response = await transport(url, { ...init, body: outgoingBody, redirect: 'error',
        ...(signals.length ? { signal: AbortSignal.any(signals) } : {}),
      });
      if (response.ok) {
        const data = await response.clone().json() as Record<string, unknown>;
        normalizeAiUsage(data.usage, checked.provider === 'openai' ? 'responses' : 'chat');
      }
      return response;
    },
  });
}

export function createAgentModelProvider(config: AiConfig, options: ClientOptions = {}) {
  return new OpenAIProvider({
    openAIClient: createAiClient(config, { ...options, maxOutputTokens: 512 }),
    useResponses: config.provider === 'openai',
  });
}

export async function analyzeWithProvider(document: string, options: {
  config?: AiConfig;
  instructions: string;
  maxOutputTokens: number;
} & ClientOptions) {
  const config = validateAiConfig(options.config ?? resolveAiConfig('analysis', options.env));
  const api = createAiClient(config, options);
  try {
    if (config.provider === 'openai') {
      const result = await api.responses.create({ model: config.model, instructions: options.instructions,
        input: document, max_output_tokens: options.maxOutputTokens, store: false });
      if (!result.output_text || result.status !== 'completed') throw new ProviderOutcomeUnknown('Provider analysis is incomplete');
      return { text: result.output_text, usage: normalizeAiUsage(result.usage, 'responses'), provider: config.provider, model: config.model };
    }
    const result = await api.chat.completions.create({ model: config.model,
      messages: [{ role: 'system', content: options.instructions }, { role: 'user', content: document }],
      max_tokens: options.maxOutputTokens, temperature: 0, stream: false,
    });
    const choice = result.choices[0];
    if (!choice?.message.content || choice.finish_reason !== 'stop' || choice.message.tool_calls?.length)
      throw new ProviderOutcomeUnknown('Provider analysis is incomplete');
    return { text: choice.message.content, usage: normalizeAiUsage(result.usage), provider: config.provider, model: config.model };
  } catch (error) {
    if (error instanceof OpenAI.APIError && [400, 401, 403, 404, 422, 429].includes(error.status ?? 0))
      throw new ProviderRejected('Provider rejected the request before execution');
    throw error;
  }
}
