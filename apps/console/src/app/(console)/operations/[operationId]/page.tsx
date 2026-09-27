import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getOperationEvidence } from '@resvary/sdk/admin';
import { getRuntime } from '@/lib/runtime';
import { PageHeader } from '@/components/page-header';
import { OperationRecoveryForm } from '@/components/operation-recovery-form';
import { formatTimestamp, formatUnits } from '@/lib/format';
import { operationDescriptions, operationLabels } from '@/lib/operations';

export default async function OperationPage({
  params,
  searchParams,
}: {
  params: Promise<{ operationId: string }>;
  searchParams: Promise<{ historyCursor?: string; actionCursor?: string }>;
}) {
  const { operationId } = await params;
  const query = await searchParams;
  const runtime = await getRuntime();
  const operation = await runtime.admin.getOperation(runtime.config.projectId, operationId);
  if (!operation) notFound();
  const [evidence, history, actions] = await Promise.all([
    getOperationEvidence(runtime.store, runtime.config.projectId, operation.operationKey),
    runtime.admin.listOperationHistory(runtime.config.projectId, operationId, {
      cursor: query.historyCursor,
      limit: 25,
    }),
    runtime.admin.listOperatorActions(runtime.config.projectId, {
      targetType: 'metered_operation',
      targetId: operation.operationKey,
      cursor: query.actionCursor,
      limit: 25,
    }),
  ]);
  if (!evidence) notFound();
  const current = evidence.operation;
  return (
    <main className="section-page operation-detail">
      <PageHeader
        title="Operation recovery"
        description={current.operationKey}
        actions={
          <Link className="quiet-button" href="/operations">
            All operations
          </Link>
        }
      />
      <section className="operation-state">
        <h2>{operationLabels[current.status]}</h2>
        <p>{operationDescriptions[current.status]}</p>
      </section>
      <div className="customer-grid">
        <section className="operation-evidence" aria-label="Operation evidence">
          <h2>Charge evidence</h2>
          <dl>
            <div>
              <dt>Customer</dt>
              <dd>
                <Link href={`/customers/${encodeURIComponent(current.customerId)}`}>
                  {current.customerId}
                </Link>
              </dd>
            </div>
            <div>
              <dt>Operation ID</dt>
              <dd>
                <code>{current.id}</code>
              </dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatTimestamp(current.createdAt)}</dd>
            </div>
            <div>
              <dt>Last updated</dt>
              <dd>{formatTimestamp(current.updatedAt)}</dd>
            </div>
            <div>
              <dt>Price version</dt>
              <dd>
                <code>{current.priceId}</code>
              </dd>
            </div>
            <div>
              <dt>Measured charge</dt>
              <dd>
                {evidence.amountUnits !== undefined
                  ? formatUnits(evidence.amountUnits)
                  : 'No saved usage'}
              </dd>
            </div>
            <div>
              <dt>Available snapshot</dt>
              <dd>{formatUnits(evidence.availableUnits)}</dd>
            </div>
            <div>
              <dt>Reconciliation attempts</dt>
              <dd>{current.reconciliationAttempt ?? 0}</dd>
            </div>
            {evidence.usageEventId && (
              <div>
                <dt>Usage event</dt>
                <dd>
                  <code>{evidence.usageEventId}</code>
                </dd>
              </div>
            )}
            {current.receiptId && (
              <div>
                <dt>Receipt</dt>
                <dd>
                  <Link
                    href={`/audit?kind=usage_receipt&entityId=${encodeURIComponent(current.receiptId)}`}
                  >
                    {current.receiptId}
                  </Link>
                </dd>
              </div>
            )}
            {current.evidenceReference && (
              <div>
                <dt>External evidence</dt>
                <dd>{current.evidenceReference}</dd>
              </div>
            )}
          </dl>
          <p className="readonly-note">
            Balances may change. The recovery transaction checks available credits again.
          </p>
          {[
            ['Original hold', evidence.reservation],
            ['Settlement hold', evidence.settlementReservation],
          ].map(([label, hold]) =>
            typeof hold === 'object' && hold ? (
              <section className="operation-hold" key={String(label)}>
                <h3>{String(label)}</h3>
                <p>
                  <code>{hold.id}</code>
                </p>
                <p>
                  {hold.status} · {formatUnits(hold.reservedUnits)} reserved
                </p>
                <p>Expires {formatTimestamp(hold.expiresAt)}</p>
              </section>
            ) : null,
          )}
          {evidence.actualUsage && (
            <details className="operation-json">
              <summary>Measured usage and price breakdown</summary>
              <pre>
                {JSON.stringify(
                  { usage: evidence.actualUsage, lineItems: evidence.lineItems },
                  null,
                  2,
                )}
              </pre>
            </details>
          )}
          <p className="readonly-note">
            Provider output, execution credentials, and provider metadata are excluded from this
            view.
          </p>
        </section>
        <aside className="operator-column">
          <h2>Recovery action</h2>
          <OperationRecoveryForm
            key={current.status}
            operationKey={current.operationKey}
            status={current.status}
            resultHash={current.resultHash}
            amountUnits={evidence.amountUnits}
            disabled={runtime.config.demoMode}
          />
        </aside>
      </div>
      <section className="operation-history">
        <h2>State transitions</h2>
        <p>
          Recorded by the coordinator from 1.3 onward. Earlier transitions are not reconstructed.
        </p>
        <ol>
          {history.items.map((event) => (
            <li key={event.id}>
              <span>#{event.sequence}</span>
              <time>{formatTimestamp(event.createdAt)}</time>
              <strong>
                {event.fromStatus ? operationLabels[event.fromStatus] : 'Created'} →{' '}
                {operationLabels[event.toStatus]}
              </strong>
            </li>
          ))}
        </ol>
        {!history.items.length && (
          <p className="empty-state">No recorded transitions for this operation.</p>
        )}
        {history.nextCursor && (
          <Link
            className="quiet-button"
            href={`?historyCursor=${encodeURIComponent(history.nextCursor)}`}
          >
            Earlier transitions
          </Link>
        )}
      </section>
      <section className="action-log">
        <header>
          <h2>Recovery command log</h2>
          <p>
            Each command preserves its reason and action ID. A failed command may leave the
            operation unresolved.
          </p>
        </header>
        <div className="data-table-wrap">
          <table className="data-table operation-table">
            <thead>
              <tr>
                <th>Action ID</th>
                <th>Action</th>
                <th>Status</th>
                <th>Reason</th>
                <th>Recorded (UTC)</th>
              </tr>
            </thead>
            <tbody>
              {actions.items.map((action) => (
                <tr key={action.id}>
                  <td data-label="Action ID">
                    <code>{action.id}</code>
                  </td>
                  <td data-label="Action">{action.type}</td>
                  <td data-label="Status">{action.status}</td>
                  <td data-label="Reason">{action.reason}</td>
                  <td data-label="Recorded (UTC)">
                    {formatTimestamp(action.completedAt ?? action.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!actions.items.length && <p className="empty-state">No recovery commands recorded.</p>}
        {actions.nextCursor && (
          <Link
            className="quiet-button"
            href={`?actionCursor=${encodeURIComponent(actions.nextCursor)}`}
          >
            Earlier commands
          </Link>
        )}
      </section>
    </main>
  );
}
