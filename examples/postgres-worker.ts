import { CreditLedger } from '@resvary/sdk/credits';
import { createPostgresCreditStore, migratePostgres } from '@resvary/postgres';
import { createHttpWebhookTransport, OutboxWorker } from '@resvary/worker';

const connectionString = requireEnv('DATABASE_URL');
const schema = process.env.RESVARY_POSTGRES_SCHEMA ?? 'public';

// Run this as a deployment step, before application and worker processes start.
await migratePostgres({ connectionString, schema });

const store = createPostgresCreditStore({ connectionString, schema });
const ledger = new CreditLedger({ projectId: 'example_ai_product', store });

await ledger.grantCredits({
  customerId: 'design_partner_customer',
  amount: '10',
  idempotencyKey: 'initial-grant',
});

const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());

const worker = new OutboxWorker({
  store,
  transport: createHttpWebhookTransport({
    url: requireEnv('RESVARY_WEBHOOK_URL'),
    secret: requireEnv('RESVARY_WEBHOOK_SECRET'),
  }),
  logger: (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`),
});

try {
  await worker.run(controller.signal);
} finally {
  await store.close();
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
