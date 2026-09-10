import { setTimeout } from 'node:timers/promises';
import { createRuntime } from './lib/runtime';
import { JobEngine } from './lib/engine';
import { paymentReadiness } from './lib/circle-cli';
import type { Job } from './lib/store';

const rt = createRuntime();
if (rt.cfg.executionMode !== 'worker')
  throw new Error('Legacy worker is disabled in workflow mode');
const lock = await rt.pool.connect();
let stopping = false;
process.on('SIGTERM', () => {
  stopping = true;
});
process.on('SIGINT', () => {
  stopping = true;
});
// A single wallet executor. A lost lock/DB connection terminates this process,
// and startup recovery never retries an unknown external operation.
lock.on('error', () => process.exit(1));
try {
  const held = (await lock.query('SELECT pg_try_advisory_lock(792138024) AS held')).rows[0].held;
  if (!held) throw new Error('Another agent-demo worker holds the wallet lock');
  await rt.jobs.recoverInterrupted();
  const engine = new JobEngine(rt);
  while (!stopping) {
    const readiness = await paymentReadiness(rt);
    await rt.jobs.readiness(readiness.ready, readiness.message);
    await rt.jobs.cleanup();
    const saved = (
      await rt.pool.query<Job>(
        "SELECT * FROM agent_demo.jobs WHERE phase='result_saved' AND expires_at>now() LIMIT 10",
      )
    ).rows;
    for (const job of saved) {
      try {
        await engine.commit(job);
      } catch {
        /* Retain known output for a later commit retry. */
      }
    }
    if (readiness.ready) {
      const job = await rt.jobs.claim();
      if (job) {
        const heartbeat = setInterval(() => {
          void rt.jobs.readiness(true, readiness.message).catch(() => {});
        }, 20_000);
        try {
          await engine.run(job.id);
        } finally {
          clearInterval(heartbeat);
        }
        continue;
      }
    }
    await setTimeout(rt.cfg.testMode ? 250 : 5_000);
  }
} finally {
  await rt.jobs.readiness(false, 'Worker is offline').catch(() => {});
  await lock.query('SELECT pg_advisory_unlock(792138024)').catch(() => {});
  lock.release();
  await rt.pool.end();
}
