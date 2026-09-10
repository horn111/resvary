import { start } from 'workflow/api';
import { documentWorkflow } from './document-workflow';
import type { Runtime } from './runtime';

export async function dispatchJob(rt: Runtime, id: string) {
  const token = await rt.jobs.claimDispatch(id);
  if (!token) return;
  // The DB row is an outbox. If enqueue succeeds but recording its run ID fails,
  // another dispatcher may enqueue again after 90s; the execution claim blocks
  // a second agent/model call. Never reset a claim immediately after an unknown start.
  const run = await start(documentWorkflow, [id]);
  await rt.jobs.recordDispatch(id, token, run.runId);
}

export async function drainDispatches(rt: Runtime) {
  const pending = await rt.jobs.pendingDispatches();
  for (const job of pending) await dispatchJob(rt, job.id);
  return pending.length;
}
