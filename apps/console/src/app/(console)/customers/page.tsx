import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { SearchIcon } from '@/components/icons';
import { getRuntime } from '@/lib/runtime';
import { formatTimestamp, formatUnits } from '@/lib/format';

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cursor?: string }>;
}) {
  const query = await searchParams;
  const runtime = await getRuntime();
  const page = await runtime.admin.listCustomers({
    projectId: runtime.config.projectId,
    search: query.q,
    cursor: query.cursor,
    limit: 50,
  });
  return (
    <main className="section-page">
      <PageHeader
        title="Customers"
        description="Balances, credit lots, receipts, funding, and one chronological account history."
        actions={
          <form className="search-form">
            <SearchIcon />
            <input
              name="q"
              defaultValue={query.q}
              placeholder="Search customer ID"
              aria-label="Search customer ID"
            />
            <button>Search</button>
          </form>
        }
      />
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Customer ID</th>
              <th>Available</th>
              <th>Posted</th>
              <th>Reserved</th>
              <th>Receipts</th>
              <th>Open reservations</th>
              <th>Last activity</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((item) => (
              <tr key={item.account.id}>
                <td>
                  <Link href={`/customers/${encodeURIComponent(item.account.customerId)}`}>
                    {item.account.customerId}
                  </Link>
                </td>
                <td>{formatUnits(item.account.availableUnits)}</td>
                <td>{formatUnits(item.account.postedUnits)}</td>
                <td>{formatUnits(item.account.reservedUnits)}</td>
                <td>{item.receiptCount}</td>
                <td>{item.openReservationCount}</td>
                <td>{formatTimestamp(item.lastActivityAt ?? item.account.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {page.items.length === 0 ? (
          <p className="empty-state">No customers match this project and search.</p>
        ) : null}
      </div>
      {page.nextCursor ? (
        <Link
          className="next-page"
          href={{ pathname: '/customers', query: { q: query.q, cursor: page.nextCursor } }}
        >
          Next 50 customers
        </Link>
      ) : null}
    </main>
  );
}
