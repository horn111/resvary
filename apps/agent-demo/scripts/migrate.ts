import { migratePostgres } from '@resvary/postgres';
import { createRuntime, price } from '../src/lib/runtime';
const rt = createRuntime();
try {
  await migratePostgres({ pool: rt.pool });
  await rt.jobs.migrate(rt.cfg.initial);
  await price(rt.ledger);
  console.log('Ledger and agent-demo migrations complete.');
} finally {
  await rt.pool.end();
}
