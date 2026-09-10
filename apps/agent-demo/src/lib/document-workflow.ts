import { sleep } from 'workflow';
import {
  closeQueuedJobStep,
  executeJobStep,
  expireContentStep,
  jobDeadlineStep,
  recoverJobStep,
} from './workflow-steps';

async function processJob(id: string) {
  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      if ((await executeJobStep(id)) !== 'busy') {
        await recoverJobStep(id);
        return;
      }
      await sleep('10s');
    }
    await closeQueuedJobStep(id);
  } catch {
    // The independent supervisor still reconciles and expires this job.
  }
}

async function superviseAndExpire(id: string, expiresAt: string) {
  // A watchdog is scheduled alongside execution, so a killed step cannot prevent
  // reconciliation. Only opaque IDs, phases and an expiry date enter Workflow storage.
  for (let attempt = 0; attempt < 5; attempt++) {
    await sleep('5m');
    try {
      const phase = await recoverJobStep(id);
      if (['completed', 'failed', 'review_required', 'expired'].includes(phase)) break;
    } catch {
      // A later attempt or the authenticated maintenance route can retry DB-only work.
    }
  }
  await sleep(new Date(expiresAt));
  await expireContentStep();
}

export async function documentWorkflow(id: string) {
  'use workflow';
  const expiresAt = await jobDeadlineStep(id);
  if (!expiresAt) return;
  await Promise.all([processJob(id), superviseAndExpire(id, expiresAt)]);
}
