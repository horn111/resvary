'use client';

import { useCallback, useEffect, useState } from 'react';

type DemoState = {
  customerId: string;
  balance: null | {
    postedAmount: string;
    reservedAmount: string;
    availableAmount: string;
  };
  price: { id: string; rates: Array<{ dimension: string; unitSize: string; amount: string }> };
  reservations: Array<{
    id: string;
    status: string;
    reservedAmount: string;
    committedAmount?: string;
    releasedAmount?: string;
  }>;
  receipts: Array<{
    id: string;
    amount: string;
    releasedAmount: string;
    usageEventId: string;
    lineItems: unknown[];
  }>;
  ledgerEntries: Array<{
    id: string;
    type: string;
    bucket: string;
    deltaUnits: string;
    balanceAfterUnits: string;
  }>;
  outboxEvents: Array<{ id: string; type: string; status: string }>;
  latestSignature: string | null;
  liveProviderConfigured: boolean;
  persistence: string;
  fundingIntents: Array<{ id: string; status: string; requestedAmount: string; invoiceId: string }>;
  fundingTransactions: Array<{
    id: string;
    txHash: string;
    amount: string;
    paymentReceiptId: string;
    grantId: string;
  }>;
};

export default function Home() {
  const [state, setState] = useState<DemoState | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('Loading persistent credit ledger…');
  const [lastRunKey, setLastRunKey] = useState('');

  const refresh = useCallback(async () => {
    const response = await fetch('/api/credits', { cache: 'no-store' });
    setState((await response.json()) as DemoState);
    setMessage('Ready');
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(
    action: 'grant' | 'run' | 'fail' | 'arc',
    options: { live?: boolean; replay?: boolean } = {},
  ) {
    setBusy(action);
    const key = options.replay && lastRunKey ? lastRunKey : crypto.randomUUID();
    if (action === 'run' && !options.replay) setLastRunKey(key);
    setMessage(options.replay ? 'Replaying the same idempotency key…' : `Running ${action}…`);
    const response = await fetch('/api/credits', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, idempotencyKey: key, live: options.live }),
    });
    const payload = (await response.json()) as DemoState | { error: string; state: DemoState };
    if ('error' in payload) {
      setState(payload.state);
      setMessage(payload.error);
    } else {
      setState(payload);
      setMessage(
        options.replay
          ? 'Replay returned the original result. No second charge.'
          : `${action} completed`,
      );
    }
    setBusy('');
  }

  const latestReceipt = state?.receipts.at(-1);
  const latestReservation = state?.reservations.at(-1);

  return (
    <main>
      <nav>
        <span className="brand">SETTLARY</span>
        <span className="alpha">0.3 ALPHA</span>
        <a href="https://github.com/horn111/settlary">GitHub ↗</a>
      </nav>
      <section className="hero">
        <p className="eyebrow">PREPAID CREDITS FOR AI PRODUCTS</p>
        <h1>
          Charge actual AI usage.
          <br />
          Never lose track of a credit.
        </h1>
        <p className="lead">
          Reserve the maximum cost before an AI job, commit actual token usage afterward, and
          release the rest with an auditable receipt.
        </p>
        <div className="actions">
          <button disabled={Boolean(busy)} onClick={() => void run('grant')}>
            Grant $5.00
          </button>
          <button
            className="primary"
            disabled={Boolean(busy) || !state?.balance}
            onClick={() => void run('run')}
          >
            Run simulated AI
          </button>
          <button
            disabled={Boolean(busy) || !lastRunKey}
            onClick={() => void run('run', { replay: true })}
          >
            Replay same request
          </button>
          <button disabled={Boolean(busy) || !state?.balance} onClick={() => void run('fail')}>
            Simulate failure
          </button>
          <button disabled={Boolean(busy)} onClick={() => void run('arc')}>
            Simulate Arc $2 top-up
          </button>
          {state?.liveProviderConfigured && (
            <button
              disabled={Boolean(busy) || !state.balance}
              onClick={() => void run('run', { live: true })}
            >
              Run live provider
            </button>
          )}
        </div>
        <div className="notice">
          <span className={busy ? 'pulse' : ''} />
          {message}
        </div>
      </section>

      <section className="balances">
        <Metric label="Posted" value={`$${state?.balance?.postedAmount ?? '0'}`} />
        <Metric label="Reserved" value={`$${state?.balance?.reservedAmount ?? '0'}`} />
        <Metric label="Available" value={`$${state?.balance?.availableAmount ?? '0'}`} accent />
      </section>

      <section className="flow">
        {[
          'Grant / top-up',
          'Reserve maximum',
          'Execute AI job',
          'Commit actual',
          'Release remainder',
          'Usage receipt',
        ].map((label, index) => (
          <div className="flowStep" key={label}>
            <b>{String(index + 1).padStart(2, '0')}</b>
            <span>{label}</span>
          </div>
        ))}
      </section>

      <section className="grid">
        <Panel
          title="Latest reservation"
          subtitle="Maximum authorization before provider execution"
        >
          <Json data={latestReservation ?? { status: 'No reservation yet' }} />
        </Panel>
        <Panel
          title="Latest usage receipt"
          subtitle="Actual charge, released amount, and price line items"
        >
          <Json data={latestReceipt ?? { status: 'No usage receipt yet' }} />
        </Panel>
        <Panel
          title="Immutable ledger"
          subtitle={`${state?.ledgerEntries.length ?? 0} entries · persisted in ${state?.persistence ?? 'SQLite'}`}
        >
          <Json data={state?.ledgerEntries.slice(-8) ?? []} />
        </Panel>
        <Panel
          title="Transactional outbox"
          subtitle="Events are stored atomically with balance changes"
        >
          <Json
            data={{
              signature: state?.latestSignature,
              events: state?.outboxEvents.slice(-8) ?? [],
            }}
          />
        </Panel>
      </section>

      <section className="details">
        <div>
          <p className="eyebrow">PRICE VERSION</p>
          <h2>Input and output tokens are rated separately.</h2>
        </div>
        <Json data={state?.price ?? { status: 'loading' }} />
      </section>

      <section className="legacy">
        <div>
          <p className="eyebrow">OPTIONAL FUNDING RAIL</p>
          <h2>Arc payments now fund credits. They no longer define the whole product.</h2>
        </div>
        <p>
          The existing invoice, memo proof, receipt, signed webhook, and replay APIs remain
          compatible. Settlary uses them as the Arc Testnet funding adapter while the credit ledger
          stays payment-rail agnostic.
        </p>
        <Json
          data={{
            intents: state?.fundingIntents.slice(-2) ?? [],
            transactions: state?.fundingTransactions.slice(-2) ?? [],
          }}
        />
        <div className="links">
          <a href="/api/receipts">Open legacy receipt demo JSON ↗</a>
          <a href="https://github.com/horn111/settlary/blob/main/docs/arc-credit-funding.md">
            Arc funding docs ↗
          </a>
        </div>
      </section>

      <footer>
        <span>Open-source · Apache-2.0</span>
        <span>Simulation by default · no AI key required</span>
      </footer>
      <style jsx>{`
        :global(*) {
          box-sizing: border-box;
        }
        :global(body) {
          margin: 0;
          background: #090a0c;
          color: #f4f2ed;
          font-family: Arial, sans-serif;
        }
        main {
          max-width: 1200px;
          margin: auto;
          padding: 0 28px;
        }
        nav {
          height: 72px;
          display: flex;
          align-items: center;
          gap: 18px;
          border-bottom: 1px solid #25272b;
        }
        nav a {
          margin-left: auto;
          color: #b9bbc1;
          text-decoration: none;
        }
        .brand {
          font-weight: 800;
          letter-spacing: 0.18em;
        }
        .alpha {
          font: 11px monospace;
          color: #ff7a59;
          border: 1px solid #6b392e;
          padding: 5px 8px;
          border-radius: 20px;
        }
        .hero {
          padding: 88px 0 52px;
          max-width: 970px;
        }
        .eyebrow {
          font: 12px monospace;
          letter-spacing: 0.14em;
          color: #ff7a59;
        }
        .hero h1 {
          font-size: clamp(46px, 7vw, 84px);
          line-height: 0.96;
          letter-spacing: -0.055em;
          margin: 22px 0;
        }
        .lead {
          max-width: 760px;
          color: #a9abb1;
          font-size: 20px;
          line-height: 1.55;
        }
        .actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          margin: 34px 0 18px;
        }
        button {
          background: #15171a;
          color: #eee;
          border: 1px solid #34373d;
          border-radius: 7px;
          padding: 12px 16px;
          cursor: pointer;
        }
        button:hover:not(:disabled) {
          border-color: #777;
        }
        button.primary {
          background: #f4f2ed;
          color: #111;
          border-color: #f4f2ed;
          font-weight: 700;
        }
        button:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .notice {
          font: 12px monospace;
          color: #85888f;
          display: flex;
          gap: 9px;
          align-items: center;
        }
        .notice span {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #55d187;
        }
        .notice .pulse {
          background: #ffb454;
          box-shadow: 0 0 0 5px #ffb45422;
        }
        .balances {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          border: 1px solid #25272b;
          border-radius: 10px;
          overflow: hidden;
        }
        .metric {
          padding: 28px;
          border-right: 1px solid #25272b;
        }
        .metric:last-child {
          border: 0;
        }
        .metric span {
          font: 11px monospace;
          color: #777b83;
          text-transform: uppercase;
        }
        .metric strong {
          display: block;
          font-size: 38px;
          margin-top: 10px;
        }
        .metric.accent strong {
          color: #55d187;
        }
        .flow {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          margin: 56px 0;
          border-top: 1px solid #25272b;
          border-bottom: 1px solid #25272b;
        }
        .flowStep {
          padding: 20px 14px;
          border-right: 1px solid #25272b;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .flowStep:last-child {
          border: 0;
        }
        .flowStep b {
          font: 11px monospace;
          color: #ff7a59;
        }
        .flowStep span {
          font-size: 13px;
        }
        .grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }
        .panel {
          border: 1px solid #25272b;
          border-radius: 9px;
          background: #0e0f12;
          min-width: 0;
        }
        .panel header {
          padding: 20px;
          border-bottom: 1px solid #25272b;
        }
        .panel h3 {
          margin: 0 0 6px;
          font-size: 16px;
        }
        .panel header span {
          color: #777b83;
          font-size: 12px;
        }
        .json {
          margin: 0;
          padding: 20px;
          overflow: auto;
          max-height: 370px;
          font: 12px/1.55 monospace;
          color: #b9d5c2;
        }
        .details,
        .legacy {
          margin: 72px 0;
          padding: 42px;
          border: 1px solid #25272b;
          border-radius: 10px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 40px;
        }
        .details h2,
        .legacy h2 {
          font-size: 30px;
          line-height: 1.15;
          margin: 12px 0;
        }
        .legacy p {
          color: #a9abb1;
          line-height: 1.6;
        }
        .links {
          display: flex;
          gap: 20px;
          margin-top: 20px;
        }
        .links a {
          color: #f4f2ed;
        }
        footer {
          border-top: 1px solid #25272b;
          padding: 30px 0 50px;
          display: flex;
          justify-content: space-between;
          color: #777b83;
          font-size: 12px;
        }
        @media (max-width: 800px) {
          .balances,
          .grid,
          .details,
          .legacy {
            grid-template-columns: 1fr;
          }
          .flow {
            grid-template-columns: repeat(2, 1fr);
          }
          .metric {
            border-right: 0;
            border-bottom: 1px solid #25272b;
          }
          .hero {
            padding-top: 60px;
          }
          .details,
          .legacy {
            padding: 24px;
          }
          footer {
            gap: 12px;
            flex-direction: column;
          }
        }
      `}</style>
    </main>
  );
}

function Metric({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className={`metric ${accent ? 'accent' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <article className="panel">
      <header>
        <h3>{title}</h3>
        <span>{subtitle}</span>
      </header>
      {children}
    </article>
  );
}
function Json({ data }: { data: unknown }) {
  return <pre className="json">{JSON.stringify(data, null, 2)}</pre>;
}
