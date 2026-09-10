import { createRuntime } from '../src/lib/runtime';
import { paymentReadiness } from '../src/lib/circle-cli';
import { demoReadiness } from '../src/lib/readiness';
const rt = createRuntime();
try {
  await rt.pool.query('SELECT 1');
  const [wallet, state] = await Promise.all([paymentReadiness(rt), demoReadiness(rt)]);
  console.log(
    JSON.stringify(
      {
        testMode: rt.cfg.testMode,
        database: 'reachable',
        wallet,
        budgetRemainingUpperBoundUsd: state.remainingUnits / 1e6,
        workerReady: state.workerReady,
        accepting: rt.cfg.accepting,
        executionMode: rt.cfg.executionMode,
      },
      null,
      2,
    ),
  );
  if (!wallet.ready || state.remainingUnits < 400_000) process.exitCode = 1;
} catch {
  console.error('Preflight failed. Check private configuration and migrations.');
  process.exitCode = 1;
} finally {
  await rt.pool.end();
}
