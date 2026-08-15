'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './interactive-credit-demo.module.css';

type DemoAction = 'grant' | 'run' | 'fail' | 'arc';

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
  liveProviderConfigured: boolean;
  persistence: string;
};

export function InteractiveCreditDemo() {
  const [state, setState] = useState<DemoState | null>(null);
  const [busy, setBusy] = useState<DemoAction | 'refresh' | ''>('refresh');
  const [message, setMessage] = useState('Loading the persisted credit ledger.');
  const [error, setError] = useState('');
  const [lastRunKey, setLastRunKey] = useState('');
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
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, idempotencyKey }),
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
  const ledger = state?.ledgerEntries.slice(-6) ?? [];

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
        <button disabled={Boolean(busy)} onClick={() => void run('arc')} type="button">
          Add Arc $2
        </button>
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

      <div className={styles.records}>
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
