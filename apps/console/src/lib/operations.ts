import type { MeteredOperationStatus } from '@resvary/sdk/credits';

export const operationLabels: Record<MeteredOperationStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  outcome_unknown: 'Outcome unknown',
  result_saved: 'Result saved',
  needs_reconciliation: 'Needs reconciliation',
  settled: 'Settled',
  cancelled: 'Cancelled',
};

export const operationDescriptions: Record<MeteredOperationStatus, string> = {
  queued: 'Waiting for a worker to claim execution. No provider call has been claimed.',
  running:
    'A worker owns the execution claim. Confirm that it stopped before marking the outcome unknown.',
  outcome_unknown:
    'The provider may have completed the work. Look up the original request with the provider. Recover a found result through the trusted SDK integration, or record evidence that no execution occurred.',
  result_saved: 'Measured usage is saved. Complete settlement without calling the provider again.',
  needs_reconciliation:
    'The original hold could not cover the saved result. Review the measured charge before authorizing a new hold.',
  settled: 'The saved usage has a receipt. Replays return the same charge.',
  cancelled:
    'No charge is due. An open hold is released by the cancellation command or expiry maintenance.',
};

export function formatAge(ms: number): string {
  if (ms < 60_000) return '<1 min';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} hr`;
  return `${Math.floor(ms / 86_400_000)} days`;
}
