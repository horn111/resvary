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
    await runtime().ledger.releaseExpiredReservations({
      idempotencyKey: `expired:${Date.now()}`,
      limit: 100,
    });
  } catch {
    throw new RetryableError('Content expiration is temporarily unavailable', { retryAfter: '1m' });
  }
}
expireContentStep.maxRetries = 10;

export async function closeQueuedJobStep(id: string) {
  'use step';
  try {
    // A full queue never starts a paid operation after its waiting window.
    const rt = runtime();
    const failure = 'The demo queue is busy. No analysis was started.';
    await rt.pool.query(
      "UPDATE agent_demo.jobs SET phase='failed',failure=$2 WHERE id=$1 AND phase='queued'",
      [id, failure],
    );
    const job = await rt.jobs.get(id);
    if (job.phase === 'failed' && job.failure === failure) {
      if (job.billing_mode === 'paid' && job.reservation_id)
        await runtime().ledger.releaseReservation({
          reservationId: job.reservation_id,
          idempotencyKey: `queue-timeout:${id}`,
          reason: 'queue_timeout',
        });
    }
  } catch {
    throw new RetryableError('Queue state is temporarily unavailable', { retryAfter: '10s' });
  }
}
