import Link from 'next/link';
import type { AdminOverview, AdminPage, AdminUsageEvidence, AuditItem } from '@resvary/sdk/admin';
import { RefreshIcon } from './icons';

export function Overview({
  overview,
  activity,
  evidence,
  demoMode,
}: {
  overview: AdminOverview;
  activity: AdminPage<AuditItem>;
  evidence?: AdminUsageEvidence;
  demoMode: boolean;
}) {
  const selected =
    activity.items.find((item) => item.kind === 'usage_receipt') ?? activity.items[0];
  return (
    <main className="overview-workspace comp-frame">
      <header className="situation-strip r-situation-metrics">
        <Metric label="Available" value={money(overview.availableUnits)} />
        <Metric label="Reserved" value={money(overview.reservedUnits)} />
        <Metric label="Charged 24h" value={money(overview.charged24hUnits)} />
        <Metric label="Overdue" value={String(overview.overdueReservationCount)} />
        <Metric label="Dead letter" value={String(overview.deadLetterCount)} />
        <div className="dataset r-dataset-label">
          <span>{demoMode ? 'DATA SYNTHETIC' : 'DATA LIVE'}</span>
          <strong>{demoMode ? 'SYNTHETIC DATA' : 'LIVE DATA'}</strong>
          <b aria-hidden="true">{demoMode ? 'SD' : 'LV'}</b>
        </div>
      </header>

      <section className="ledger-panel">
        <div className="ledger-toolbar r-ledger-controls">
          <div>
            <h1>
              COMMAND LEDGER <span>(LIVE)</span>
            </h1>
          </div>
          <dl className="scope-row" aria-label="Current activity scope">
            <ScopeDatum label="Events" value="All activity" />
            <ScopeDatum label="Statuses" value="All states" />
            <ScopeDatum label="Customers" value="Entire project" />
            <ScopeDatum label="Window" value="Latest 25 records" />
            <Link className="refresh-button" href="/">
              <RefreshIcon /> Refresh
            </Link>
          </dl>
        </div>
        <div className="ledger-table-wrap r-ledger-table">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Timestamp (UTC)</th>
                <th>Event type</th>
                <th>Customer ID</th>
                <th>Amount (USD)</th>
                <th>Status</th>
                <th>Ledger ID</th>
              </tr>
            </thead>
            <tbody>
              {activity.items.map((item) => (
                <tr
                  key={`${item.kind}:${item.id}`}
                  className={item.id === selected?.id ? 'selected' : undefined}
                >
                  <td data-label="Timestamp (UTC)">
                    <time dateTime={new Date(item.createdAt).toISOString()}>
                      {timestamp(item.createdAt)}
                    </time>
                  </td>
                  <td data-label="Event type">{item.type}</td>
                  <td data-label="Customer ID">{item.customerId ?? '—'}</td>
                  <td data-label="Amount (USD)" className="amount">
                    {displayAmount(item)}
                  </td>
                  <td data-label="Status">
                    <span className={`event-status status-${displayStatus(item)}`}>
                      {displayStatus(item)}
                    </span>
                  </td>
                  <td data-label="Ledger ID" title={item.id}>
                    {item.id}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {activity.items.length === 0 ? (
            <div className="empty-state">No activity matches this project.</div>
          ) : null}
        </div>
        <div className="ledger-footer r-ledger-pagination">
          <span>Rows per page: 25</span>
          <span>1–{activity.items.length}</span>
        </div>
        <ChargesChart overview={overview} />
      </section>

      <aside className="event-panel r-event-details">
        <div className="event-panel-heading">
          <h2>EVENT DETAILS</h2>
          <span aria-hidden="true">×</span>
        </div>
        {selected ? (
          <>
            <div className="event-summary">
              <span className="event-chip">{selected.type}</span>
              <span className="event-state">{displayStatus(selected)}</span>
              <time>
                {new Date(selected.createdAt).toISOString().replace('T', ' ').replace('Z', ' UTC')}
              </time>
              <dl>
                <div>
                  <dt>Customer</dt>
                  <dd>{selected.customerId ?? 'Project event'}</dd>
                </div>
                <div>
                  <dt>Amount (USD)</dt>
                  <dd>{displayAmount(selected)}</dd>
                </div>
                <div>
                  <dt>Ledger ID</dt>
                  <dd>{selected.id}</dd>
                </div>
              </dl>
            </div>
            <h3>EVIDENCE CHAIN</h3>
            {evidence ? (
              <EvidenceChain evidence={evidence} />
            ) : (
              <div className="empty-evidence">
                <span>1</span>
                <p>
                  This event has no receipt evidence chain. Open Audit Explorer to inspect the
                  original JSON and related entities.
                </p>
              </div>
            )}
            <details className="json-disclosure r-event-json">
              <summary>View full event JSON</summary>
              <pre>{JSON.stringify(selected.payload, null, 2)}</pre>
            </details>
          </>
        ) : (
          <div className="empty-state">Select an event to inspect its evidence.</div>
        )}
      </aside>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ScopeDatum({ label, value }: { label: string; value: string }) {
  return (
    <div className="scope-datum">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function ChargesChart({ overview }: { overview: AdminOverview }) {
  const max = overview.dailyCharges.reduce(
    (value, day) => (BigInt(day.amountUnits) > value ? BigInt(day.amountUnits) : value),
    1n,
  );
  return (
    <section
      className="charges-chart r-charges-chart"
      aria-label="Charged amount trend over the last 30 days"
    >
      <div className="chart-heading">
        <h2>CHARGED (USD) TREND — LAST 30 DAYS</h2>
        <span>Daily total</span>
      </div>
      <div className="bars">
        {overview.dailyCharges.map((day) => {
          const height = Number((BigInt(day.amountUnits) * 100n) / max);
          return (
            <div
              key={day.day}
              className="bar-column"
              title={`${day.day}: ${money(day.amountUnits)}`}
            >
              <i style={{ height: `${Math.max(height, 2)}%` }} />
              <span>{day.day.slice(5)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function EvidenceChain({ evidence }: { evidence: AdminUsageEvidence }) {
  const records = [
    {
      title: 'USAGE RECEIPT',
      id: evidence.receipt.id,
      state: 'received',
      rows: [
        ['At', timestamp(evidence.receipt.createdAt)],
        ['Source', evidence.receipt.priceId],
        ['Usage', JSON.stringify(evidence.receipt.lineItems.map((item) => item.quantity))],
        ['Customer', evidence.receipt.customerId],
        ['Usage event', evidence.receipt.usageEventId],
      ],
    },
    evidence.reservation
      ? {
          title: 'RESERVATION',
          id: evidence.reservation.id,
          state: evidence.reservation.status,
          rows: [
            ['At', timestamp(evidence.reservation.createdAt)],
            ['Amount (USD)', money(evidence.reservation.reservedUnits)],
            ['Expires at', timestamp(evidence.reservation.expiresAt)],
            ['Policy', 'bounded usage'],
            ['Customer', evidence.reservation.customerId],
          ],
        }
      : undefined,
    evidence.price
      ? {
          title: 'PRICE VERSION',
          id: evidence.price.id,
          state: 'applied',
          rows: [
            ['Product', evidence.price.meterKey],
            ['Unit price (USD)', evidence.price.rates[0]?.amount ?? '—'],
            ['Currency', evidence.price.currency],
            ['Effective', timestamp(evidence.price.createdAt)],
            ['Source', 'price registry'],
          ],
        }
      : undefined,
    ...evidence.ledgerEntries.slice(0, 2).map((entry) => ({
      title: `LEDGER ${entry.bucket.toUpperCase()}`,
      id: entry.id,
      state: 'posted',
      rows: [
        ['At', timestamp(entry.createdAt)],
        ['Amount (USD)', signedMoney(entry.deltaUnits)],
        ['Balance after', money(entry.balanceAfterUnits)],
        ['Entry type', entry.type],
        ['Reference', entry.referenceId],
      ],
    })),
  ].filter(Boolean) as Array<{ title: string; id: string; state: string; rows: string[][] }>;
  return (
    <ol className="evidence-chain">
      {records.map((record, index) => (
        <li key={`${record.title}:${record.id}`}>
          <span className="step">{index + 1}</span>
          <article>
            <header>
              <strong>{record.title}</strong>
              <span>{record.state}</span>
            </header>
            <dl>
              <div>
                <dt>ID</dt>
                <dd>{record.id}</dd>
              </div>
              {record.rows.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </article>
        </li>
      ))}
    </ol>
  );
}

function timestamp(value: number) {
  return new Date(value).toISOString().replace('T', ' ').slice(0, 23);
}
function money(units: string) {
  const negative = units.startsWith('-');
  const value = BigInt(negative ? units.slice(1) : units);
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n)
    .toString()
    .padStart(6, '0')
    .replace(/0+$/, '')
    .padEnd(2, '0');
  return `${negative ? '-' : ''}$${whole.toLocaleString('en-US')}.${fraction || '00'}`;
}
function signedMoney(units: string) {
  const value = BigInt(units);
  return `${value > 0n ? '+' : ''}${money(units)}`;
}
function displayStatus(item: AuditItem) {
  return item.kind === 'usage_receipt' ? 'posted' : (item.status ?? 'recorded');
}
function displayAmount(item: AuditItem) {
  if (!item.amountUnits) return '—';
  return item.kind === 'usage_receipt'
    ? money(`-${item.amountUnits.replace(/^-/, '')}`)
    : signedMoney(item.amountUnits);
}
