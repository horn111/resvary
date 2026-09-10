import { Pool } from 'pg';
import { CreditLedger } from '@resvary/sdk/credits';
import { createPostgresCreditStore } from '@resvary/postgres';
import { config } from './config';
import { JobStore } from './store';

export function createRuntime() {
  const cfg = config();
  const databaseUrl = new URL(cfg.databaseUrl);
  if (['prefer', 'require', 'verify-ca'].includes(databaseUrl.searchParams.get('sslmode') ?? ''))
    databaseUrl.searchParams.set('sslmode', 'verify-full');
  const pool = new Pool({
    connectionString: databaseUrl.href,
    max: cfg.executionMode === 'workflow' ? 3 : 10,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  });
  const ledger = new CreditLedger({
    projectId: 'ethonline-agent-demo',
    store: createPostgresCreditStore({ pool }),
  });
  return { cfg, pool, ledger, jobs: new JobStore(pool) };
}
export type Runtime = ReturnType<typeof createRuntime>;
const shared = globalThis as typeof globalThis & { agentDemoRuntime?: Runtime };
export const runtime = () => (shared.agentDemoRuntime ??= createRuntime());

export async function price(ledger: CreditLedger) {
  await ledger.registerMeter({
    key: 'document_tokens',
    dimensions: ['input_tokens', 'output_tokens'],
    idempotencyKey: 'document-meter-v1',
  });
  return ledger.createPriceVersion({
    meterKey: 'document_tokens',
    rates: [
      { dimension: 'input_tokens', unitSize: '1000', amount: '0.002' },
      { dimension: 'output_tokens', unitSize: '1000', amount: '0.008' },
    ],
    idempotencyKey: 'document-price-v1',
  });
}
