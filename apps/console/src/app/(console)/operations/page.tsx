import { PageHeader } from '@/components/page-header';
import { RequeueForm, SweepForm } from '@/components/operator-forms';
import { getRuntime } from '@/lib/runtime';
import { formatTimestamp } from '@/lib/format';

export default async function OperationsPage() {
  const runtime = await getRuntime();
  const [overview, overdue, deadLetters, actions] = await Promise.all([
    runtime.admin.getOverview(runtime.config.projectId),
    runtime.admin.listOverdueReservations(runtime.config.projectId),
    runtime.admin.listDeadLetterEvents(runtime.config.projectId),
    runtime.admin.listOperatorActions(runtime.config.projectId, { limit: 50 }),
  ]);
  return (
    <main className="section-page">
      <PageHeader
        title="Operations"
        description="Only bounded recovery work: expired reservations, dead-letter events, and migration health."
      />
      <section className="health-strip">
        <div>
          <span>Database</span>
          <strong>{runtime.database}</strong>
        </div>
        <div>
          <span>Schema</span>
          <strong>v{runtime.schemaVersion} compatible</strong>
        </div>
        <div>
          <span>Pending events</span>
          <strong>{overview.pendingOutboxCount}</strong>
        </div>
        <div>
          <span>Reconciliation</span>
          <strong>{overview.reconciliationRequiredCount}</strong>
        </div>
      </section>
      <div className="operations-grid">
        <section>
          <header>
            <h2>Overdue reservations</h2>
            <p>Only reservations whose stored expiry is already in the past can be swept.</p>
          </header>
          <SweepForm
            overdueCount={overdue.length}
            disabled={runtime.config.demoMode || overdue.length === 0}
          />
          <div className="operation-list">
            {overdue.map((reservation) => (
              <article key={reservation.id}>
                <div>
                  <strong>{reservation.customerId}</strong>
                  <code>{reservation.id}</code>
                </div>
                <span>Expired {formatTimestamp(reservation.expiresAt)}</span>
              </article>
            ))}
            {overdue.length === 0 ? <p className="empty-state">No overdue reservations.</p> : null}
          </div>
        </section>
        <section>
          <header>
            <h2>Dead-letter events</h2>
            <p>Requeue is available only while the stored event status is dead_letter.</p>
          </header>
          <div className="operation-list">
            {deadLetters.map((event) => (
              <article key={event.id}>
                <div>
                  <strong>{event.type}</strong>
                  <code>{event.id}</code>
                </div>
                <span>{event.lastError ?? 'Delivery failed'}</span>
                <RequeueForm eventId={event.id} disabled={runtime.config.demoMode} />
              </article>
            ))}
            {deadLetters.length === 0 ? (
              <p className="empty-state">No dead-letter events.</p>
            ) : null}
          </div>
        </section>
      </div>
      <section className="action-log">
        <header>
          <h2>Operator action log</h2>
          <p>Latest immutable transition per idempotency key. Earlier transitions remain stored.</p>
        </header>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Recorded</th>
                <th>Action ID</th>
                <th>Action</th>
                <th>Target</th>
                <th>Status</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {actions.items.map((action) => (
                <tr key={action.id}>
                  <td>{formatTimestamp(action.completedAt ?? action.createdAt)}</td>
                  <td>
                    <code>{action.id}</code>
                  </td>
                  <td>{action.type}</td>
                  <td>{action.targetId}</td>
                  <td>{action.status}</td>
                  <td>{action.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {actions.items.length === 0 ? (
            <p className="empty-state">No operator actions recorded.</p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
