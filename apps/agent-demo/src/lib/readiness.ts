import { paymentReadiness } from './circle-cli';
import { aiReadiness } from './ai-providers';
import type { Runtime } from './runtime';

const pending = new WeakMap<Runtime, Promise<{ ready: boolean; message: string }>>();

export async function demoReadiness(rt: Runtime) {
  const budget = await rt.jobs.status();
  if (rt.cfg.executionMode !== 'workflow') return budget;
  const ai = rt.cfg.testMode ? { ready: true as const } : aiReadiness();
  if (!ai.ready) return { ...budget, workerReady: false, message: ai.reason };
  const cached = await rt.jobs.cachedReadiness();
  let readiness = cached;
  if (!readiness) {
    let check = pending.get(rt);
    if (!check) {
      check = paymentReadiness(rt)
        .then(async (result) => {
          await rt.jobs.readiness(result.ready, result.message);
          return result;
        })
        .finally(() => pending.delete(rt));
      pending.set(rt, check);
    }
    readiness = await check;
  }
  return { ...budget, workerReady: readiness.ready, message: readiness.message };
}
