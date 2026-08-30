'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './interactive-credit-demo.module.css';

type DemoAction =
  | 'grant'
  | 'run'
  | 'fail'
  | 'arc'
  | 'arc_prepare'
  | 'arc_confirm'
  | 'gateway_prepare'
  | 'gateway_settle'
  | 'gateway_replay';
type FundingMethod = 'arc' | 'gateway';

type ArcFundingRequest = {
  fundingIntentId: string;
  status: 'pending' | 'confirmed' | 'failed';
  amount: string;
  invoice: {
    payTo: string;
  };
  paymentRequest: {
    memoContract: string;
    txData: string;
    memoId: string;
  };
};

type GatewayFundingRequest = {
  fundingIntentId: string;
  status: 'pending' | 'confirmed' | 'failed';
  amount: string;
  rail: 'circle_gateway_nanopayment';
  network: string;
  paymentRequired: Record<string, unknown>;
  buyerCommand: string;
};

type DemoState = {
  balance: null | {
    postedAmount: string;
    reservedAmount: string;
    availableAmount: string;
  };
  reservations: Array<Record<string, unknown>>;
  receipts: Array<Record<string, unknown>>;
  ledgerEntries: Array<Record<string, unknown>>;
  outboxEvents: Array<Record<string, unknown>>;
  fundingTransactions: Array<Record<string, unknown>>;
  arcLiveFundingTransaction: Record<string, unknown> | null;
  persistence: string;
  arcLiveConfigured: boolean;
  arcFundingRequest: ArcFundingRequest | null;
  gatewayFundingRequest: GatewayFundingRequest | null;
  gatewayFundingTransaction: Record<string, unknown> | null;
  policyScenario: Record<string, unknown>;
};

export function InteractiveCreditDemo() {
  const [state, setState] = useState<DemoState | null>(null);
  const [busy, setBusy] = useState<DemoAction | 'refresh' | ''>('refresh');
  const [message, setMessage] = useState('Loading the persisted credit ledger.');
  const [error, setError] = useState('');
  const [lastRunKey, setLastRunKey] = useState('');
  const [arcTxHash, setArcTxHash] = useState('');
  const [adminToken, setAdminToken] = useState('');
  const [fundingMethod, setFundingMethod] = useState<FundingMethod>('arc');
  const mutationController = useRef<AbortController | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setBusy('refresh');
    setError('');
    try {
      const response = await fetch('/api/credits', { cache: 'no-store', signal });
      if (!response.ok) throw new Error(`The demo API returned ${response.status}.`);
      setState((await response.json()) as DemoState);
      setMessage('Credit ledger ready.');
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'The demo could not load. Check the connection and try again.',
      );
      setMessage('Credit ledger unavailable.');
    } finally {
      if (!signal?.aborted) setBusy('');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => {
      controller.abort();
      mutationController.current?.abort();
    };
  }, [refresh]);

  async function run(action: DemoAction, replay = false) {
    if (busy) return;
    const idempotencyKey = replay && lastRunKey ? lastRunKey : crypto.randomUUID();
    if (action === 'run' && !replay) setLastRunKey(idempotencyKey);
    mutationController.current?.abort();
    const controller = new AbortController();
    mutationController.current = controller;
    setBusy(action);
    setError('');
    setMessage(
      replay
        ? 'Replaying the previous idempotency key.'
        : action === 'fail'
          ? 'Running a request that will fail at the provider.'
          : `Running ${action}.`,
    );

    try {
      const response = await fetch('/api/credits', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
        },
        body: JSON.stringify({
          action,
          idempotencyKey,
          fundingIntentId:
            action === 'arc_confirm'
              ? state?.arcFundingRequest?.fundingIntentId
              : action === 'gateway_settle' || action === 'gateway_replay'
                ? state?.gatewayFundingRequest?.fundingIntentId
                : undefined,
          txHash: action === 'arc_confirm' ? arcTxHash.trim() : undefined,
        }),
        signal: controller.signal,
      });
      const payload = (await response.json()) as DemoState | { error: string; state: DemoState };
      if ('error' in payload) {
        setState(payload.state);
        throw new Error(payload.error);
      }
      setState(payload);
      setMessage(
        replay
          ? 'Replay returned the stored result. No second charge was created.'
          : action === 'fail'
            ? 'Provider failure released the full reservation.'
            : action === 'grant'
              ? 'Five development credits were granted.'
              : action === 'arc'
                ? 'Simulated Arc funding added two credits.'
                : action === 'arc_prepare'
                  ? 'Live Arc Testnet funding request created.'
                  : action === 'arc_confirm'
                    ? 'Arc Testnet payment verified and credits granted once.'
                    : action === 'gateway_prepare'
                      ? 'Gateway Nanopayment funding request created.'
                      : action === 'gateway_settle'
                        ? 'Gateway payment settled and credits granted once.'
                        : action === 'gateway_replay'
                          ? 'The same Gateway authorization returned the stored grant.'
                          : 'Usage committed and the unused reservation was released.',
      );
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'The operation failed. The persisted ledger state is unchanged.',
      );
      setMessage('Operation failed.');
    } finally {
      if (!controller.signal.aborted) setBusy('');
      if (mutationController.current === controller) mutationController.current = null;
    }
  }

  const latestReservation = state?.reservations.at(-1) ?? { status: 'No reservation yet' };
  const latestReceipt = state?.receipts.at(-1) ?? { status: 'No usage receipt yet' };
  const latestFunding = state?.arcLiveFundingTransaction ?? null;
  const latestGatewayFunding = state?.gatewayFundingTransaction ?? null;
  const ledger = state?.ledgerEntries.slice(-6) ?? [];
  const explorerUrl = getExplorerUrl(latestFunding);

  return (
    <div className={styles.demo} aria-busy={Boolean(busy)}>
      <div className={styles.headingRow}>
        <div>
          <span className={styles.label}>Interactive ledger</span>
          <h3>Run the actual API-backed lifecycle</h3>
        </div>
        <span className={styles.persistence}>{state?.persistence ?? 'SQLite'}</span>
      </div>

      <div className={styles.actions} aria-label="Credit demo actions">
        <label className={styles.adminAccess}>
          <span>Demo admin token</span>
          <input
            autoComplete="off"
            onChange={(event) => setAdminToken(event.target.value)}
            placeholder="RESVARY_DEMO_ADMIN_TOKEN"
            type="password"
            value={adminToken}
          />
        </label>
        <button disabled={Boolean(busy)} onClick={() => void run('grant')} type="button">
          Grant $5
        </button>
        <button
          className={styles.primaryAction}
          disabled={Boolean(busy) || !state?.balance}
          onClick={() => void run('run')}
          type="button"
        >
          Run simulated AI
        </button>
        <button
          disabled={Boolean(busy) || !lastRunKey}
          onClick={() => void run('run', true)}
          type="button"
        >
          Replay same request
        </button>
        <button
          disabled={Boolean(busy) || !state?.balance}
          onClick={() => void run('fail')}
          type="button"
        >
          Simulate failure
        </button>
      </div>

      <div className={styles.actions} aria-label="Funding method">
        <button
          className={fundingMethod === 'arc' ? styles.primaryAction : undefined}
          disabled={Boolean(busy)}
          onClick={() => setFundingMethod('arc')}
          type="button"
        >
          Arc USDC
        </button>
        <button
          className={fundingMethod === 'gateway' ? styles.primaryAction : undefined}
          disabled={Boolean(busy)}
          onClick={() => setFundingMethod('gateway')}
          type="button"
        >
          Gateway Nanopayment
        </button>
      </div>

      <div className={styles.actions} aria-label="Funding actions">
        {fundingMethod === 'arc' ? (
          <>
            <button disabled={Boolean(busy)} onClick={() => void run('arc')} type="button">
              Simulate Arc $2
            </button>
            <button
              disabled={Boolean(busy) || !state?.arcLiveConfigured}
              onClick={() => void run('arc_prepare')}
              title={
                state?.arcLiveConfigured
                  ? 'Create calldata for a real Arc Testnet payment'
                  : 'Set RESVARY_ARC_FUNDING_RECIPIENT to enable live proof'
              }
              type="button"
            >
              Create live Arc request
            </button>
          </>
        ) : (
          <>
            <button
              disabled={Boolean(busy)}
              onClick={() => void run('gateway_prepare')}
              type="button"
            >
              Create Gateway request
            </button>
            <button
              disabled={
                Boolean(busy) ||
                !state?.gatewayFundingRequest ||
                state.gatewayFundingRequest.status !== 'pending'
              }
              onClick={() => void run('gateway_settle')}
              type="button"
            >
              Verify, settle, and credit
            </button>
            <button
              disabled={
                Boolean(busy) ||
                !state?.gatewayFundingRequest ||
                state.gatewayFundingRequest.status !== 'confirmed'
              }
              onClick={() => void run('gateway_replay')}
              type="button"
            >
              Replay authorization
            </button>
          </>
        )}
      </div>

      <div className={styles.statusRow}>
        <span className={busy ? styles.statusPulse : styles.statusDot} aria-hidden="true" />
        <p aria-live="polite" role="status">
          {busy ? message : error || message}
        </p>
        {error ? (
          <button className={styles.retry} onClick={() => void refresh()} type="button">
            Retry
          </button>
        ) : null}
      </div>

      <dl className={styles.balances}>
        <Metric label="Posted" value={state?.balance?.postedAmount ?? '0'} />
        <Metric label="Reserved" value={state?.balance?.reservedAmount ?? '0'} />
        <Metric label="Available" value={state?.balance?.availableAmount ?? '0'} />
      </dl>

      {state?.gatewayFundingRequest ? (
        <section className={styles.arcProof} aria-labelledby="gateway-proof-title">
          <div className={styles.arcProofHeading}>
            <div>
              <span className={styles.label}>Circle Gateway � Arc Testnet</span>
              <h4 id="gateway-proof-title">
                {state.gatewayFundingRequest.status === 'confirmed'
                  ? 'Settled once; replay returns the same grant'
                  : 'One Nanopayment funds the credit ledger'}
              </h4>
            </div>
            <span className={styles.arcAmount}>{state.gatewayFundingRequest.amount} USDC</span>
          </div>
          <p className={styles.arcInstructions}>
            This deterministic demo uses the same verify � settle � credit adapter with a local
            facilitator fixture. The public evidence flow replaces that fixture with Circle&apos;s
            Testnet facilitator and records its settlement reference.
          </p>
          <dl className={styles.arcDetails}>
            <ArcDetail label="Rail" value={state.gatewayFundingRequest.rail} />
            <ArcDetail label="Network" value={state.gatewayFundingRequest.network} />
            <ArcDetail label="Buyer example" value={state.gatewayFundingRequest.buyerCommand} />
          </dl>
          <div className={styles.arcResult}>
            <Record
              title="x402 payment requirements"
              value={state.gatewayFundingRequest.paymentRequired}
            />
            {latestGatewayFunding ? (
              <Record title="Gateway payment!� credit grant" value={latestGatewayFunding} />
            ) : null}
          </div>
        </section>
      ) : null}

      {state?.arcFundingRequest ? (
        <section className={styles.arcProof} aria-labelledby="arc-proof-title">
          <div className={styles.arcProofHeading}>
            <div>
              <span className={styles.label}>Real Arc Testnet proof</span>
              <h4 id="arc-proof-title">
                {state.arcFundingRequest.status === 'confirmed'
                  ? 'Replay or inspect this funding proof'
                  : 'Fund this credit intent onchain'}
              </h4>
            </div>
            <span className={styles.arcAmount}>{state.arcFundingRequest.amount} USDC</span>
          </div>

          <p className={styles.arcInstructions}>
            {state.arcFundingRequest.status === 'confirmed'
              ? 'Paste the verified transaction hash again to demonstrate that replay protection returns the stored funding result without creating another credit grant.'
              : 'Call the Arc Memo contract from a funded Testnet EOA using the calldata below. Paste the resulting transaction hash to verify its Memo event and USDC transfer before the ledger grants credits.'}
          </p>

          <dl className={styles.arcDetails}>
            <ArcDetail label="Recipient" value={state.arcFundingRequest.invoice.payTo} />
            <ArcDetail
              label="Memo contract"
              value={state.arcFundingRequest.paymentRequest.memoContract}
            />
            <ArcDetail label="Memo ID" value={state.arcFundingRequest.paymentRequest.memoId} />
            <ArcDetail
              label="Transaction calldata"
              value={state.arcFundingRequest.paymentRequest.txData}
            />
          </dl>

          <div className={styles.arcConfirm}>
            <label htmlFor="arc-tx-hash">Arc Testnet transaction hash</label>
            <div>
              <input
                autoComplete="off"
                disabled={Boolean(busy)}
                id="arc-tx-hash"
                onChange={(event) => setArcTxHash(event.target.value)}
                placeholder="0x…"
                spellCheck={false}
                value={arcTxHash}
              />
              <button
                disabled={Boolean(busy) || !/^0x[0-9a-fA-F]{64}$/.test(arcTxHash.trim())}
                onClick={() => void run('arc_confirm')}
                type="button"
              >
                Verify and grant credits
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {latestFunding ? (
        <section className={styles.arcProof} aria-label="Verified Arc funding result">
          <div className={styles.arcResult}>
            <Record title="Latest verified Arc funding transaction" value={latestFunding} />
            {explorerUrl ? (
              <a href={explorerUrl} rel="noreferrer" target="_blank">
                View verified transaction on Arcscan ↗
              </a>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className={styles.records}>
        <Record
          title="0.7 allowance, promotion priority, and expiry scenario"
          value={state?.policyScenario ?? { status: 'Loading policy scenario' }}
        />
        <Record title="Latest reservation" value={latestReservation} />
        <Record title="Latest usage receipt" value={latestReceipt} />
        <Record title={`Ledger · ${ledger.length} recent entries`} value={ledger} />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Record({ title, value }: { title: string; value: unknown }) {
  return (
    <article>
      <h4>{title}</h4>
      <pre tabIndex={0}>{JSON.stringify(value, null, 2)}</pre>
    </article>
  );
}

function ArcDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function getExplorerUrl(value: Record<string, unknown> | null): string | null {
  if (!value || typeof value.metadata !== 'object' || value.metadata === null) return null;
  const url = (value.metadata as Record<string, unknown>).explorerUrl;
  return typeof url === 'string' && url.startsWith('https://') ? url : null;
}
