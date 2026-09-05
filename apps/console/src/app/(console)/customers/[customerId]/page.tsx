import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { AdjustmentForm, GrantForm } from '@/components/operator-forms';
import { getRuntime } from '@/lib/runtime';
import { formatTimestamp, formatUnits } from '@/lib/format';

type TimelineRecord = {
  id: string;
  kind: string;
  label: string;
  status?: string;
  amountUnits?: string;
  createdAt: number;
  payload: unknown;
};

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  const runtime = await getRuntime();
  const customer = await runtime.admin.getCustomer(
    runtime.config.projectId,
    decodeURIComponent(customerId),
  );
  if (!customer) notFound();
  const timeline: TimelineRecord[] = [
    ...customer.grants.map((item) => ({
      id: item.id,
      kind: 'Grant',
      label: item.source,
      amountUnits: item.amountUnits,
      createdAt: item.createdAt,
      payload: item,
    })),
    ...customer.reservations.map((item) => ({
      id: item.id,
      kind: 'Reservation',
      label: item.priceId,
      status: item.status,
      amountUnits: item.reservedUnits,
      createdAt: item.createdAt,
      payload: item,
    })),
    ...customer.receipts.map((item) => ({
      id: item.id,
      kind: 'Receipt',
      label: item.priceId,
      status: 'posted',
      amountUnits: `-${item.amountUnits}`,
      createdAt: item.createdAt,
      payload: item,
    })),
    ...customer.ledgerEntries.map((item) => ({
      id: item.id,
      kind: 'Ledger',
      label: `${item.bucket}.${item.type}`,
      amountUnits: item.deltaUnits,
      createdAt: item.createdAt,
      payload: item,
    })),
    ...customer.fundingIntents.map((item) => ({
      id: item.id,
      kind: 'Funding intent',
      label: item.rail,
      status: item.status,
      amountUnits: item.requestedUnits,
      createdAt: item.createdAt,
      payload: item,
    })),
    ...customer.fundingTransactions.map((item) => ({
      id: item.id,
      kind: 'Funding',
      label: item.rail,
      status: item.settlementStatus,
      amountUnits: item.amountUnits,
      createdAt: item.createdAt,
      payload: item,
    })),
  ].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
  return (
    <main className="section-page customer-page">
      <PageHeader
        title={customer.account.customerId}
        description={`Account ${customer.account.id} · ${customer.account.currency}`}
        actions={
          <Link
            className="quiet-button"
            href={`/audit?customerId=${encodeURIComponent(customer.account.customerId)}`}
          >
            Open in Audit Explorer
          </Link>
        }
      />
      <section className="balance-band">
        <div>
          <span>Available</span>
          <strong>{formatUnits(customer.account.availableUnits)}</strong>
        </div>
        <div>
          <span>Posted</span>
          <strong>{formatUnits(customer.account.postedUnits)}</strong>
        </div>
        <div>
          <span>Reserved</span>
          <strong>{formatUnits(customer.account.reservedUnits)}</strong>
        </div>
        <div>
          <span>Credit lots</span>
          <strong>{customer.lots.length}</strong>
        </div>
      </section>
      <div className="customer-grid">
        <section>
          <h2>Account timeline</h2>
          <ol className="timeline">
            {timeline.map((item) => (
              <li key={`${item.kind}:${item.id}`}>
                <time>{formatTimestamp(item.createdAt)}</time>
                <div>
                  <strong>{item.kind}</strong>
                  <span>{item.label}</span>
                </div>
                <code>{item.id}</code>
                <span>{item.status ?? 'recorded'}</span>
                <b>{item.amountUnits ? formatUnits(item.amountUnits, true) : '—'}</b>
                <details>
                  <summary>JSON</summary>
                  <pre>{JSON.stringify(item.payload, null, 2)}</pre>
                </details>
              </li>
            ))}
          </ol>
          {timeline.length === 0 ? (
            <p className="empty-state">No account activity recorded.</p>
          ) : null}
        </section>
        <aside className="operator-column">
          <h2>Protected actions</h2>
          <p>Every mutation gets a UUID idempotency key and an append-only operator record.</p>
          <GrantForm
            customerId={customer.account.customerId}
            availableUnits={customer.account.availableUnits}
            disabled={runtime.config.demoMode}
          />
          <AdjustmentForm
            customerId={customer.account.customerId}
            availableUnits={customer.account.availableUnits}
            disabled={runtime.config.demoMode}
          />
        </aside>
      </div>
    </main>
  );
}
