import { describe, expect, it } from 'vitest';
import { healthIssues, type OperationsSnapshot } from './operations-health';

const now = Date.parse('2026-10-05T12:00:00Z');
const healthy: OperationsSnapshot = {
  remaining_units: '7580000',
  ceiling: '10000000',
  expired_content: 0,
  stale_dispatches: 0,
  stale_executor: 0,
  saved_results: 0,
  review_required: 0,
  last_succeeded_at: new Date(now - 60_000),
  last_failed_at: null,
};

describe('operational alert thresholds', () => {
  it('allows a healthy daily cron and alerts before the next run becomes unaffordable', () => {
    expect(healthIssues(healthy, now)).toEqual([]);
    expect(healthIssues({ ...healthy, remaining_units: '2000000' }, now)).toEqual(['budget_low']);
    expect(healthIssues({ ...healthy, remaining_units: '399999' }, now)).toEqual([
      'budget_exhausted',
    ]);
  });
  it('requires evidence of a recent successful maintenance run, not just an attempt', () => {
    expect(healthIssues({ ...healthy, last_succeeded_at: null }, now)).toContain(
      'maintenance_overdue',
    );
    expect(
      healthIssues({ ...healthy, last_succeeded_at: new Date(now - 27 * 3600000) }, now),
    ).toContain('maintenance_overdue');
    expect(healthIssues({ ...healthy, last_failed_at: new Date(now) }, now)).toEqual([
      'maintenance_failed',
    ]);
    expect(healthIssues({ ...healthy, last_failed_at: new Date(now - 120000) }, now)).toEqual([]);
  });
  it('reports retained content and unknown outcomes without clearing them', () => {
    expect(
      healthIssues(
        {
          ...healthy,
          expired_content: 1,
          stale_dispatches: 1,
          stale_executor: 1,
          saved_results: 1,
          review_required: 1,
        },
        now,
      ),
    ).toEqual([
      'content_cleanup_overdue',
      'dispatch_overdue',
      'execution_overdue',
      'settlement_overdue',
      'operator_review_required',
    ]);
  });
});
