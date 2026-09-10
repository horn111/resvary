import { describe, expect, it, vi } from 'vitest';
import { Agent, Runner, tool } from '@openai/agents';
import { z } from 'zod';
import { aiReadiness, analyzeWithProvider, conservativeRunBudgetUnits, createAgentModelProvider,
  normalizeAiUsage, ProviderOutcomeUnknown, ProviderRejected, resolveAiConfig, validateAiConfig } from './ai-providers';

const env = { AGENT_DEMO_AI_PROVIDER: 'nous', NOUS: 'fixture-only-key' };
const config = resolveAiConfig('analysis', env);
const completion = (extra: Record<string, unknown> = {}) => new Response(JSON.stringify({
  id: 'fixture-completion', object: 'chat.completion', created: 1, model: config.model,
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Known result' } }],
  usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 }, ...extra,
}), { status: 200, headers: { 'content-type': 'application/json' } });
const options = { config, env, instructions: 'Analyze only.', maxOutputTokens: 1_024 };

describe('bounded AI provider transport', () => {
  it('resolves separate roles and accepts existing key aliases without persisting credentials', () => {
    const agent = resolveAiConfig('agent', { ...env, AGENT_DEMO_AGENT_MODEL: 'openai/gpt-4.1-mini' });
    expect(agent.model).toBe('openai/gpt-4.1-mini');
    expect(config.model).toBe('qwen/qwen3.8-flash');
    expect(JSON.stringify(agent)).not.toContain('fixture-only-key');
    expect(aiReadiness(env).ready).toBe(true);
    expect(aiReadiness({ ...env, NOUS: '' }).ready).toBe(false);
    expect(conservativeRunBudgetUnits(agent, config)).toBeLessThan(400_000);
  });
  it('rejects unsupported models, object property names and altered tariff snapshots', () => {
    for (const model of ['not-reviewed', '__proto__', 'constructor']) {
      expect(() => resolveAiConfig('agent', { ...env, AGENT_DEMO_AGENT_MODEL: model })).toThrow(ProviderRejected);
    }
    expect(() => validateAiConfig({ ...config, inputUsdPerMillion: 0 })).toThrow(ProviderRejected);
  });
  it('maps token usage and refuses missing, fractional or negative counts', () => {
    expect(normalizeAiUsage({ prompt_tokens: 3, completion_tokens: 4 })).toEqual({ input_tokens: '3', output_tokens: '4' });
    for (const value of [undefined, -1, 1.5, '4', NaN]) {
      expect(() => normalizeAiUsage({ prompt_tokens: 3, completion_tokens: value })).toThrow(ProviderOutcomeUnknown);
    }
  });
  it('returns known output and sends the fixed endpoint with disabled reasoning and no redirects', async () => {
    const transport = vi.fn(async () => completion());
    const result = await analyzeWithProvider('A public fixture.', { ...options, fetch: transport });
    expect(result.text).toBe('Known result');
    expect(result.usage).toEqual({ input_tokens: '20', output_tokens: '10' });
    const [url, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://inference-api.nousresearch.com/v1/chat/completions');
    expect(init.redirect).toBe('error');
    expect(JSON.parse(String(init.body)).reasoning).toEqual({ enabled: false });
  });
  it('rejects oversized input before sending any request', async () => {
    const transport = vi.fn(async () => completion());
    await expect(analyzeWithProvider('x'.repeat(20_000), { ...options, fetch: transport })).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it('does not retry server failures or transport timeouts', async () => {
    for (const response of [async () => new Response('{}', { status: 500 }), async () => { throw new Error('network outcome unknown'); }]) {
      const transport = vi.fn(response);
      await expect(analyzeWithProvider('Fixture.', { ...options, fetch: transport })).rejects.toThrow();
      expect(transport).toHaveBeenCalledTimes(1);
    }
  });
  it('propagates the run deadline into the provider request without retrying', async () => {
    const controller = new AbortController();
    const transport = vi.fn(async (_url: unknown, init?: RequestInit) => {
      controller.abort(new Error('Fixture run deadline'));
      expect(init?.signal?.aborted).toBe(true);
      throw init?.signal?.reason;
    });
    await expect(analyzeWithProvider('Fixture.', { ...options, signal: controller.signal, fetch: transport })).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('distinguishes an HTTP rejection from an incomplete generated answer', async () => {
    await expect(analyzeWithProvider('Fixture.', { ...options, fetch: async () => new Response('{}', { status: 401 }) })).rejects.toBeInstanceOf(ProviderRejected);
    await expect(analyzeWithProvider('Fixture.', { ...options, fetch: async () => completion({ choices: [{ finish_reason: 'length', message: { content: 'Partial answer' } }] }) })).rejects.toBeInstanceOf(ProviderOutcomeUnknown);
  });
  it('uses native tool calls through the installed Agents SDK', async () => {
    const execute = vi.fn(async () => ({ status: 'funded' }));
    const transport = vi.fn(async () => completion({ choices: [{ index: 0, finish_reason: 'tool_calls', message: {
      role: 'assistant', content: null, tool_calls: [{ id: 'call_fixture', type: 'function', function: { name: 'top_up', arguments: '{}' } }],
    } }] }));
    const agent = new Agent({ name: 'Fixture buyer', model: config.model, instructions: 'Use the tool.',
      tools: [tool({ name: 'top_up', description: 'Fixture only.', parameters: z.object({}), execute })],
      toolUseBehavior: 'stop_on_first_tool', modelSettings: { maxTokens: 512, parallelToolCalls: false, retry: { maxRetries: 0 } },
    });
    const runner = new Runner({ tracingDisabled: true, modelProvider: createAgentModelProvider(config, { env, fetch: transport }) });
    await runner.run(agent, 'Run the fixture.', { maxTurns: 1 });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
