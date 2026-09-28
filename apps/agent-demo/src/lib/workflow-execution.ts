import { randomUUID } from 'node:crypto';
import { JobEngine } from './engine';
import type { Runtime } from './runtime';

export async function executeWorkflowJob(rt: Runtime, id: string, engine = new JobEngine(rt)) {
  const token = randomUUID();
  const claimed = await rt.jobs.claimWorkflow(id, token);
  if (claimed !== 'claimed') return claimed;
  // Release only after the engine returns. If it escapes because its final state
  // could not be persisted, retaining the claim lets the durable supervisor mark
  // the job for review before making the shared wallet available again.
  await engine.run(id);
  await rt.jobs.finishWorkflow(id, token);
  return 'finished' as const;
}

export async function recoverWorkflowJob(rt: Runtime, id: string, engine = new JobEngine(rt)) {
  await rt.jobs.reconcileWorkflows();
  const state = await rt.jobs.executionStatus(id);
  if (!state || state.expires_at.getTime() <= Date.now()) return 'expired';
  if (state.phase === 'result_saved') {
    const saved = await rt.jobs.get(id);
    if (saved.billing_mode === 'paid' && !saved.agent_usage) {
      if (state.execution_started_at && state.execution_started_at.getTime() < Date.now() - 600_000)
        await rt.jobs.patch(id, {
          phase: 'review_required',
          failure: 'Agent usage was interrupted. Credits remain reserved for operator review.',
        });
      return (await rt.jobs.executionStatus(id))?.phase ?? 'expired';
    }
    // Only the persisted provider output is used. commitUsage has a stable key.
    await engine.execute(id);
    return (await rt.jobs.executionStatus(id))?.phase ?? 'expired';
  }
  return state.phase;
}
