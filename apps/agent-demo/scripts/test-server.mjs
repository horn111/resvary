import { tsImport } from 'tsx/esm/api';
import next from 'next';
import { createServer } from 'node:http';
const database = process.env.TEST_DATABASE_URL;
if (
  !database ||
  !new URL(database).pathname.endsWith('_test') ||
  !['127.0.0.1', 'localhost'].includes(new URL(database).hostname)
)
  throw new Error('Use a dedicated loopback TEST_DATABASE_URL ending in _test');
const env = {
  ...process.env,
  DATABASE_URL: database,
  AGENT_DEMO_SECRET: 'local-fixture-secret-not-for-production',
  AGENT_DEMO_ORIGIN: 'http://127.0.0.1:3100',
  AGENT_DEMO_TEST_MODE: 'true',
  AGENT_DEMO_ACCEPTING: 'true',
  AGENT_DEMO_EXECUTION_MODE: process.env.AGENT_DEMO_TEST_EXECUTION_MODE ?? 'worker',
  AGENT_DEMO_PAYER: '0x2222222222222222222222222222222222222222',
  AGENT_DEMO_SELLER: '0x1111111111111111111111111111111111111111',
  NEXT_TELEMETRY_DISABLED: '1',
};
Object.assign(process.env, env);
await tsImport('./migrate.ts', import.meta.url);
// One process lets Playwright stop the fixture web server and worker together.
if (env.AGENT_DEMO_EXECUTION_MODE === 'worker')
  void tsImport('../src/worker.ts', import.meta.url).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
const app = next({ dir: process.cwd(), dev: false, hostname: '127.0.0.1', port: 3100 });
await app.prepare();
const handler = app.getRequestHandler();
createServer((request, response) => {
  // Fixture harness only, never part of the production Next app. This avoids
  // orphaned Windows processes when Playwright cannot terminate a process group.
  if (request.method === 'POST' && request.url === '/__test_shutdown') {
    response.end('stopped');
    setTimeout(() => process.exit(0), 50);
    return;
  }
  void handler(request, response);
}).listen(3100, '127.0.0.1');
