/** Four-call live Agents SDK compatibility test. All tools are synthetic. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Agent, Runner, tool } from '@openai/agents';
import { z } from 'zod';
import { createAgentModelProvider, resolveAiConfig } from '../src/lib/ai-providers';

const root = resolve(import.meta.dirname, '../../..');
process.loadEnvFile(resolve(root, '.env.agent-demo.local'));
const path = resolve(root, '.local/generated-collateral/agent-demo-probes/provider-probe.json');
const journal = JSON.parse(await readFile(path, 'utf8')) as Array<
  Record<string, unknown> & { heldUsd: number }
>;
if (journal.some((item) => item.test === 'sdk-chain'))
  throw new Error('SDK probe already attempted; no automatic rerun');
const save = () => writeFile(path, JSON.stringify(journal, null, 2));
const config = resolveAiConfig('agent', { AGENT_DEMO_AI_PROVIDER: 'nous' });
const actions: string[] = [];
let funded = false;
let completed = false;
const clientFetch: typeof fetch = async (url, init) => {
  const body = String(init?.body);
  const heldUsd =
    ((Buffer.byteLength(body) + 1024) * config.inputUsdPerMillion +
      512 * config.outputUsdPerMillion) /
    1e6;
  if (
    heldUsd > 0.02 ||
    journal.length >= 12 ||
    journal.reduce((sum, entry) => sum + entry.heldUsd, 0) + heldUsd > 0.5
  )
    throw new Error('Probe budget envelope exceeded');
  const record: Record<string, unknown> & { heldUsd: number } = {
    at: new Date().toISOString(),
    provider: config.provider,
    model: config.model,
    test: 'sdk-chain',
    outcome: 'pending',
    heldUsd,
  };
  journal.push(record);
  await save();
  const start = performance.now();
  try {
    const response = await fetch(url, init);
    record.status = response.status;
    const data = await response.clone().json();
    record.outcome = response.ok ? 'returned' : 'http_rejected';
    record.usage = data.usage;
    record.finishReason = data.choices?.[0]?.finish_reason;
    record.toolCalls =
      data.choices?.[0]?.message?.tool_calls?.map(
        (call: { function?: unknown }) => call.function,
      ) ?? [];
    return response;
  } catch (error) {
    record.outcome = 'unknown';
    record.errorType = (error as Error).name;
    throw error;
  } finally {
    record.elapsedMs = Math.round(performance.now() - start);
    await save();
  }
};
const agent = new Agent({
  name: 'Synthetic Resvary buyer',
  model: config.model,
  instructions:
    'Fulfil one document analysis request. First check the balance and quote. If funds are insufficient, top up once. Then analyze the document. Stop after completed or any uncertain payment/provider error. Never repeat a payment or an uncertain analysis. You cannot change amounts, addresses or document contents.',
  tools: [
    tool({
      name: 'check_balance_and_quote',
      description: 'Read the balance and required reservation.',
      parameters: z.object({}),
      execute: async () => {
        actions.push('check');
        return { availableUnits: '0', requiredUnits: '3200', needsTopUp: true };
      },
    }),
    tool({
      name: 'top_up',
      description: 'Buy missing credits. Fixed server intent and amount.',
      parameters: z.object({}),
      execute: async () => {
        if (funded) throw new Error('Duplicate topup');
        actions.push('top_up');
        funded = true;
        return { status: 'funded' };
      },
    }),
    tool({
      name: 'analyze_document',
      description: 'Execute the paid document analysis and return completion status.',
      parameters: z.object({}),
      execute: async () => {
        if (!funded || completed) throw new Error('Invalid analysis state');
        actions.push('analyze');
        completed = true;
        return { status: 'completed' };
      },
    }),
  ],
  modelSettings: {
    maxTokens: 512,
    parallelToolCalls: false,
    store: false,
    retry: { maxRetries: 0 },
  },
});
const runner = new Runner({
  tracingDisabled: true,
  modelProvider: createAgentModelProvider(config, {
    fetch: clientFetch,
    signal: AbortSignal.timeout(180_000),
  }),
});
try {
  const result = await runner.run(
    agent,
    'Analyze the document attached to this job using the paid API.',
    { maxTurns: 4 },
  );
  const pass = completed && actions.join(',') === 'check,top_up,analyze';
  console.log(
    JSON.stringify({
      test: 'sdk-chain',
      pass,
      actions,
      usage: result.state.usage,
      calls: journal.filter((item) => item.test === 'sdk-chain').length,
      conservativeTotalHeldUsd: journal.reduce((sum, entry) => sum + entry.heldUsd, 0),
    }),
  );
  if (!pass) process.exitCode = 1;
} catch (error) {
  console.log(
    JSON.stringify({ test: 'sdk-chain', pass: false, actions, errorType: (error as Error).name }),
  );
  process.exitCode = 1;
}
