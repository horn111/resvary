import type { Runtime } from './runtime';
import { RUN_BUDGET_UNITS } from './config';
import { buildInfo } from './build-info';

export interface OperationsSnapshot {
  remaining_units: string;
  ceiling: string;
  expired_content: number;
  stale_dispatches: number;
  stale_executor: number;
  saved_results: number;
  review_required: number;
  last_succeeded_at: Date | null;
  last_failed_at: Date | null;
}

export function healthIssues(snapshot: OperationsSnapshot, now = Date.now()) {
  const issues: string[] = [];
  const remaining = Number(snapshot.remaining_units);
  if (remaining < RUN_BUDGET_UNITS) issues.push('budget_exhausted');
  else if (remaining <= Math.max(RUN_BUDGET_UNITS, Number(snapshot.ceiling) * 0.2))
    issues.push('budget_low');
  if (snapshot.expired_content) issues.push('content_cleanup_overdue');
  if (snapshot.stale_dispatches) issues.push('dispatch_overdue');
  if (snapshot.stale_executor) issues.push('execution_overdue');
  if (snapshot.saved_results) issues.push('settlement_overdue');
  if (snapshot.review_required) issues.push('operator_review_required');
  if (
    !snapshot.last_succeeded_at ||
    now - snapshot.last_succeeded_at.getTime() > 26 * 60 * 60 * 1000
  )
    issues.push('maintenance_overdue');
  if (
    snapshot.last_failed_at &&
    (!snapshot.last_succeeded_at || snapshot.last_failed_at > snapshot.last_succeeded_at)
  )
    issues.push('maintenance_failed');
  return issues;
}

export async function operationsHealth(rt: Runtime) {
  const { rows } = await rt.pool.query<OperationsSnapshot>(`
    SELECT (ceiling-allocated)::text AS remaining_units,ceiling::text,
      (SELECT count(*)::int FROM agent_demo.jobs WHERE expires_at<now()-interval '5 minutes'
        AND (document IS NOT NULL OR result IS NOT NULL)) AS expired_content,
      (SELECT count(*)::int FROM agent_demo.jobs WHERE phase='queued' AND expires_at>now()
        AND workflow_run_id IS NULL AND created_at<now()-interval '2 minutes') AS stale_dispatches,
      (SELECT count(*)::int FROM agent_demo.executor WHERE job_id IS NOT NULL
        AND started_at<now()-interval '10 minutes') AS stale_executor,
      (SELECT count(*)::int FROM agent_demo.jobs WHERE phase='result_saved'
        AND execution_started_at<now()-interval '10 minutes') AS saved_results,
      (SELECT count(*)::int FROM agent_demo.jobs WHERE phase='review_required') AS review_required,
      (SELECT last_succeeded_at FROM agent_demo.maintenance WHERE id=1) AS last_succeeded_at,
      (SELECT last_failed_at FROM agent_demo.maintenance WHERE id=1) AS last_failed_at
    FROM agent_demo.budget WHERE id=1
  `);
  if (!rows[0]) throw new Error('Missing operations state');
  const issues = healthIssues(rows[0]);
  if (!rt.cfg.accepting) issues.push('admission_paused');
  return { ok: issues.length === 0, build: buildInfo(), issues };
}
