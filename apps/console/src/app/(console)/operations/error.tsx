'use client';

import Link from 'next/link';

export default function OperationsError({ reset }: { reset: () => void }) {
  return (
    <main className="section-page">
      <h1>Operations could not be loaded</h1>
      <p role="alert">
        Check the database connection and migrations. An invalid pagination link can also cause this
        error.
      </p>
      <button onClick={reset}>Try again</button>{' '}
      <Link className="quiet-button" href="/operations">
        Reset filters
      </Link>
    </main>
  );
}
