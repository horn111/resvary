import Link from 'next/link';
import styles from './not-found.module.css';

export default function NotFound() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/">
          Resvary.
        </Link>
        <span>1.0 stable</span>
      </header>

      <section className={styles.content} aria-labelledby="not-found-title">
        <div className={styles.code}>404 / Route not found</div>
        <h1 id="not-found-title">This route does not exist.</h1>
        <p>
          Return to the product overview or inspect the published credit ledger preview. The
          documentation remains available in the repository.
        </p>
        <div className={styles.actions}>
          <Link className={styles.primary} href="/">
            Return home
          </Link>
          <Link className={styles.secondary} href="/#interactive-demo">
            Explore the ledger
          </Link>
        </div>
      </section>

      <footer className={styles.footer}>
        <a href="https://github.com/horn111/resvary#readme">Documentation</a>
        <a href="https://github.com/horn111/resvary/issues">Report a broken link</a>
      </footer>
    </main>
  );
}
