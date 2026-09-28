import Link from 'next/link';
import { METERED_OPERATION_STATUSES, type AdminOperationStore } from '@resvary/sdk/admin';
import type { MeteredOperationStatus } from '@resvary/sdk/credits';
import { formatAge, operationLabels } from '@/lib/operations';
import { formatTimestamp } from '@/lib/format';

export async function MeteredOperations({
  admin,
  projectId,
  query,
}: {
  admin: AdminOperationStore;
  projectId: string;
  query: Record<string, string | undefined>;
}) {
  const now = Date.now();
  const status = METERED_OPERATION_STATUSES.includes(query.status as MeteredOperationStatus)
    ? (query.status as MeteredOperationStatus)
    : undefined;
  const ageHours = ['1', '24', '168'].includes(query.age ?? '') ? Number(query.age) : 0;
  const [health, page] = await Promise.all([
    admin.getOperationHealth(projectId, now),
    admin.listOperations({
      projectId,
      status,
      search: query.search?.slice(0, 200),
      updatedBefore: ageHours ? now - ageHours * 3_600_000 : undefined,
      cursor: query.cursor,
      limit: 50,
    }),
  ]);
  const next = new URLSearchParams();
  for (const key of ['status', 'search', 'age']) if (query[key]) next.set(key, query[key]!);
  if (page.nextCursor) next.set('cursor', page.nextCursor);
  return (
    <section className="metered-operations" aria-labelledby="metered-operations-title">
      <header className="operation-section-header">
        <div>
          <h2 id="metered-operations-title">Metered operations</h2>
          <p>Find saved results and unknown outcomes before recovering a charge.</p>
        </div>
        <Link className="quiet-button" href="/operations">
          Refresh operations
        </Link>
      </header>
      <dl className="operation-health">
        <div>
          <dt>Outcome unknown</dt>
          <dd>{health.byStatus.outcome_unknown.count}</dd>
        </div>
        <div>
          <dt>Result saved</dt>
          <dd>{health.byStatus.result_saved.count}</dd>
        </div>
        <div>
          <dt>Needs reconciliation</dt>
          <dd>{health.byStatus.needs_reconciliation.count}</dd>
        </div>
        <div>
          <dt>Oldest unresolved</dt>
          <dd>{health.unresolvedCount ? formatAge(health.oldestUnresolvedAgeMs) : 'None'}</dd>
        </div>
      </dl>
      <form className="audit-filters operation-filters" action="/operations">
        <label>
          Search operations
          <input
            name="search"
            defaultValue={query.search}
            maxLength={200}
            placeholder="Operation key, ID, or customer"
          />
        </label>
        <label>
          Operation status
          <select name="status" defaultValue={status ?? ''}>
            <option value="">All statuses</option>
            {METERED_OPERATION_STATUSES.map((value) => (
              <option key={value} value={value}>
                {operationLabels[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Last update
          <select name="age" defaultValue={ageHours || ''}>
            <option value="">Any time</option>
            <option value="1">Over 1 hour ago</option>
            <option value="24">Over 1 day ago</option>
            <option value="168">Over 7 days ago</option>
          </select>
        </label>
        <button>Filter operations</button>
      </form>
      <div className="data-table-wrap">
        <table className="data-table operation-table">
          <caption className="sr-only">Metered operations in this project</caption>
          <thead>
            <tr>
              <th>Operation</th>
              <th>Customer</th>
              <th>Status</th>
              <th>Age</th>
              <th>Last updated (UTC)</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((operation) => (
              <tr key={operation.id}>
                <td data-label="Operation">
                  <Link href={`/operations/${operation.id}`}>{operation.operationKey}</Link>
                </td>
                <td data-label="Customer">
                  <Link href={`/customers/${encodeURIComponent(operation.customerId)}`}>
                    {operation.customerId}
                  </Link>
                </td>
                <td data-label="Status">{operationLabels[operation.status]}</td>
                <td data-label="Age">{formatAge(now - operation.createdAt)}</td>
                <td data-label="Updated (UTC)">{formatTimestamp(operation.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!page.items.length && (
          <p className="empty-state">
            No operations match these filters. Durable operations appear here after your application
            creates them.
          </p>
        )}
      </div>
      {page.nextCursor && (
        <Link className="quiet-button operation-next" href={`/operations?${next}`}>
          Older operations
        </Link>
      )}
    </section>
  );
}
