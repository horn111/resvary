import styles from './credit-boundary.module.css';

const pointNode = (label: string, name: string) =>
  `<div class="${styles.nodeMarker}" data-diagram-anchor="${name}" aria-hidden="true"><svg viewBox="0 0 72 72" fill="none"><circle class="${styles.orbit}" cx="36" cy="36" r="34" /><circle class="${styles.point}" cx="36" cy="36" r="3" /></svg><span class="${styles.nodeTag}">${label}</span></div>`;

export const CREDIT_BOUNDARY_HTML = `<div class="${styles.network}" data-credit-boundary="true" data-reactive-diagram="true">
  <div class="${styles.hubColumn}">
    <svg class="${styles.connections}" viewBox="0 0 100 100" preserveAspectRatio="none" fill="none" aria-hidden="true">
      <path class="${styles.reserveWire}" d="M0 22H14L38 50H50" />
      <path class="${styles.retryWire}" d="M100 22H86L62 50H50" />
      <path class="${styles.receiptWire}" d="M0 78H14L38 50H50" />
      <path class="${styles.fundingWire}" d="M100 78H86L62 50H50" />
    </svg>
    <div class="${styles.hub}" data-diagram-anchor="ledger" aria-hidden="true">
      <svg viewBox="0 0 160 160" fill="none">
        <circle class="${styles.orbit}" cx="80" cy="80" r="76" />
        <circle class="${styles.innerOrbit}" cx="80" cy="80" r="43" />
        <circle class="${styles.point}" cx="80" cy="80" r="3" />
      </svg>
    </div>
    <div class="${styles.hubLabel}" data-diagram-hotspot="ledger"><span>Resvary</span><span>Credit ledger</span></div>
  </div>
  <ul class="${styles.capabilities}">
    <li class="${styles.node} ${styles.reserve}" data-credit-capability="reserve" data-diagram-hotspot="reserve">
      ${pointNode('Reserve', 'reserve')}
      <div class="${styles.nodeBody}">
        <h3>Authorize spend before execution</h3>
        <p>Resvary checks available credits and creates an atomic reservation before your application starts provider work. Overlapping requests cannot reserve the same credits twice when the store supplies the required transaction isolation.</p>
      </div>
    </li>
    <li class="${styles.node} ${styles.retry}" data-credit-capability="retry" data-diagram-hotspot="retry">
      ${pointNode('Retry safety', 'retry')}
      <div class="${styles.nodeBody}">
        <h3>Charge once across retries</h3>
        <p>Every mutating command requires an idempotency key. Replaying the same key and payload returns the original result. Reusing the key with different input raises a conflict.</p>
      </div>
    </li>
    <li class="${styles.node} ${styles.receipt}" data-credit-capability="receipt" data-diagram-hotspot="receipt">
      ${pointNode('Receipts', 'receipt')}
      <div class="${styles.nodeBody}">
        <h3>Explain each balance change</h3>
        <p>Immutable ledger entries and per-charge usage receipts record the price version, line items, amount charged, amount released, and balance after the operation.</p>
      </div>
    </li>
    <li class="${styles.node} ${styles.funding}" data-credit-capability="funding" data-diagram-hotspot="funding">
      ${pointNode('Funding', 'funding')}
      <div class="${styles.nodeBody}">
        <h3>Keep payment rails separate from usage</h3>
        <p>The credit lifecycle does not depend on an AI provider. Manual grants, direct Arc USDC transfers, and Circle Gateway Nanopayments all fund the same ledger without changing usage accounting.</p>
      </div>
    </li>
  </ul>
</div>`;
