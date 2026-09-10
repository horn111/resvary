import { FatalError, RetryableError } from 'workflow';
import { runtime } from './runtime';
import { executeWorkflowJob, recoverWorkflowJob } from './workflow-execution';

export async function jobDeadlineStep(id: string) {
  'use step';
  try {
    return (await runtime().jobs.executionStatus(id))?.expires_at.toISOString() ?? null;
  } catch {
    throw new RetryableError('Job metadata is temporarily unavailable', { retryAfter: '10s' });
  }
}

export async function executeJobStep(id: string) {
  'use step';
  try {
    return await executeWorkflowJob(runtime(), id);
  } catch {
    // Do not serialize provider/CLI exceptions, or replay an uncertain external call.
    throw new FatalError('Execution interrupted; reconcile the persisted job state');
  }
}
executeJobStep.maxRetries = 0;

export async function recoverJobStep(id: string) {
  'use step';
  try {
    return await recoverWorkflowJob(runtime(), id);
  } catch {
    throw new RetryableError('Saved result reconciliation is temporarily unavailable', {
      retryAfter: '30s',
    });
  }
}

export async function expireContentStep() {
  'use step';
  try {
    await runtime().jobs.cleanup();
  } catch {
    throw new RetryableError('Content expiration is temporarily unavailable', { retryAfter: '1m' });
  }
}
expireContentStep.maxRetries = 10;

export async function closeQueuedJobStep(id: string) {
  'use step';
  try {
    // A full queue never starts a paid operation after its waiting window.
    if (await runtime().jobs.transition(id, ['queued'], 'failed')) {
      await runtime().jobs.patch(id, {
        failure: 'The demo queue is busy. No analysis was started.',
      });
    }
  } catch {
    throw new RetryableError('Queue state is temporarily unavailable', { retryAfter: '10s' });
  }
}
