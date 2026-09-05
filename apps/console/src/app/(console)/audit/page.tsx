import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { getRuntime } from '@/lib/runtime';
import { formatTimestamp, formatUnits } from '@/lib/format';
import type { AuditItemKind } from '@resvary/sdk/admin';

const kinds: AuditItemKind[] = [
  'grant',
  'reservation',
  'usage_receipt',
  'ledger_entry',
  'funding_intent',
  'funding_transaction',
  'outbox_event',
  'operator_action',
];

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const query = await searchParams;
  const runtime = await getRuntime();
  const kind = kinds.includes(query.kind as AuditItemKind)
    ? (query.kind as AuditItemKind)
    : undefined;
  const page = await runtime.admin.listAuditItems({
    projectId: runtime.config.projectId,
    customerId: query.customerId,
    entityId: query.entityId,
    kind,
    type: query.type,
    status: query.status,
    from: parseDate(query.from),
    to: parseDate(query.to, true),
    cursor: query.cursor,
    limit: 50,
  });
  const selected = page.items.find((item) => item.id === query.selected) ?? page.items[0];
  const evidence =
    selected?.kind === 'usage_receipt'
      ? await runtime.admin.getUsageEvidence(runtime.config.projectId, selected.id)
      : undefined;
  return (
    <main className="section-page audit-page">
      <PageHeader
        title="Audit Explorer"
        description="Follow an entity through immutable prices, reservations, receipts, funding, and ledger entries."
      />
      <form className="audit-filters">
        <label>
          Customer ID
          <input name="customerId" defaultValue={query.customerId} />
        </label>
        <label>
          Entity ID
          <input name="entityId" defaultValue={query.entityId} />
        </label>
        <label>
          Kind
          <select name="kind" defaultValue={kind ?? ''}>
            <option value="">All</option>
            {kinds.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Type
          <input name="type" defaultValue={query.type} />
        </label>
        <label>
          Status
          <input name="status" defaultValue={query.status} />
        </label>
        <label>
          From
          <input type="date" name="from" defaultValue={query.from} />
        </label>
        <label>
          To
          <input type="date" name="to" defaultValue={query.to} />
        </label>
        <button>Apply filters</button>
      </form>
      <div className="audit-grid">
        <div className="data-table-wrap">
          <table className="data-table audit-results">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Kind</th>
                <th>Type</th>
                <th>Customer</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((item) => (
                <tr
                  key={`${item.kind}:${item.id}`}
                  className={item.id === selected?.id ? 'selected' : undefined}
                >
                  <td>
                    <Link href={{ pathname: '/audit', query: { ...query, selected: item.id } }}>
                      {formatTimestamp(item.createdAt)}
                    </Link>
                  </td>
                  <td>{item.kind}</td>
                  <td>{item.type}</td>
                  <td>{item.customerId ?? '—'}</td>
                  <td>
                    {item.amountUnits
                      ? formatUnits(
                          item.kind === 'usage_receipt' ? `-${item.amountUnits}` : item.amountUnits,
                          true,
                        )
                      : '—'}
                  </td>
                  <td>{item.status ?? 'recorded'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <aside className="audit-dossier">
          {selected ? (
            <>
              <header>
                <h2>{selected.type}</h2>
                <code>{selected.id}</code>
              </header>
              {evidence ? (
                <div className="relationship-chain">
                  <span>Charge</span>
                  <i />
                  <span>Receipt</span>
                  <i />
                  <span>Reservation</span>
                  <i />
                  <span>Price</span>
                  <i />
                  <span>Ledger entries</span>
                </div>
              ) : null}
              <dl>
                <div>
                  <dt>Project</dt>
                  <dd>{selected.projectId}</dd>
                </div>
                <div>
                  <dt>Customer</dt>
                  <dd>{selected.customerId ?? 'Project event'}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{selected.status ?? 'recorded'}</dd>
                </div>
                <div>
                  <dt>Recorded</dt>
                  <dd>{formatTimestamp(selected.createdAt)}</dd>
                </div>
              </dl>
              <details open>
                <summary>Original JSON</summary>
                <pre>{JSON.stringify(selected.payload, null, 2)}</pre>
              </details>
              {evidence ? (
                <details>
                  <summary>Linked evidence</summary>
                  <pre>{JSON.stringify(evidence, null, 2)}</pre>
                </details>
              ) : null}
            </>
          ) : (
            <p className="empty-state">No audit records match these filters.</p>
          )}
        </aside>
      </div>
      {page.nextCursor ? (
        <Link
          className="next-page"
          href={{ pathname: '/audit', query: { ...query, cursor: page.nextCursor } }}
        >
          Next 50 records
        </Link>
      ) : null}
    </main>
  );
}

function parseDate(value: string | undefined, end = false): number | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z`).getTime();
  return Number.isFinite(date) ? date : undefined;
}
