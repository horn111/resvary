'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import WalletPanel from './wallet-panel';

const examples = [
  {
    name: 'Launch memo',
    text: 'Pilot launch memo\n\nThe team will open a document review pilot to 20 customers on October 1. Each customer can submit three documents. The pilot budget is $600. Maya owns support and Leo owns billing.\n\nThe launch depends on completing the access-control review by September 25. If the review is late, the pilot moves by one week. Success means at least 12 customers complete two reviews. The memo does not set a retention period for customer documents.',
  },
  {
    name: 'Service agreement',
    text: 'Draft service agreement\n\nNorth Studio will deliver a working prototype to Oak Labs by November 15 for $4,000. Oak Labs pays 30% at signing and 70% after acceptance. Acceptance requires the prototype to pass the three workflows listed in Appendix A. Appendix A has not yet been supplied.\n\nThe price includes two revision rounds. Additional changes require written approval. The draft does not specify who owns the source code or how long Oak Labs has to accept or reject delivery.',
  },
];
type Receipt = {
  id: string;
  amount: string;
  amountUnits: string;
  releasedAmount: string;
  releasedUnits: string;
  balanceAfterUnits: string;
};
type Job = {
  document?: string | null;
  id: string;
  phase: string;
  result: string | null;
  receipt: Receipt | null;
  failure: string | null;
  events: { seq: string; kind: string; detail: Record<string, unknown> }[];
};
type Status = {
  wallet: string | null;
  freeRunsRemaining: number;
  maxPaidAmount: string;
  topUpAmounts: string[];
  accepting: boolean;
  balance: string;
  testMode: boolean;
  arcEnvironment: 'mainnet' | 'testnet';
  message: string;
  jobs: { id: string; phase: string }[];
};
const terminal = new Set(['completed', 'failed', 'review_required', 'awaiting_credits']);
const labels: Record<string, string> = {
  topup_required: 'Balance below quote. Top-up required.',
  payment_started: 'Circle Agent Wallet payment started',
  credits_funded: 'Gateway payment accepted. Product credits granted.',
  credits_reserved: 'Credits reserved for the maximum quote',
  analysis_started: 'Paid document analysis started',
  usage_charged: 'Measured usage charged. Unused reserve released.',
  reservation_released: 'Provider rejected request. Reserve released.',
  review_required: 'Paused for operator review',
};
const money = (value: string | number) => `$${Number(value).toFixed(6)}`;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    ...init,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'Request failed');
  return body;
}

export default function Demo() {
  const [document, setDocument] = useState(examples[0].text);
  const [status, setStatus] = useState<Status | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [replayed, setReplayed] = useState(false);
  const request = useRef<{ key: string; document: string } | null>(null);
  const bytes = new TextEncoder().encode(document).length;
  const active = submitting || Boolean(job && !terminal.has(job.phase));
  const paid = status?.freeRunsRemaining === 0;
  const canPay =
    !paid ||
    Boolean(
      status?.wallet &&
      (Number(status.balance) >= Number(status.maxPaidAmount) || job?.phase === 'awaiting_credits'),
    );
  const refresh = useCallback(async () => {
    setStatus(await api<Status>('status'));
  }, []);

  function replaceDocument(nextDocument: string) {
    setDocument(nextDocument);
    setJob(null);
    setError('');
    setReplayed(false);
    request.current = null;
  }

  useEffect(() => {
    const abort = new AbortController();
    async function start() {
      try {
        await api('session', { method: 'POST', signal: abort.signal });
        const current = await api<Status>('status', { signal: abort.signal });
        setStatus(current);
        if (current.jobs[0]) {
          const restored = await api<Job>(`jobs/${current.jobs[0].id}`, { signal: abort.signal });
          setJob(restored);
          if (restored.phase === 'awaiting_credits' && restored.document)
            setDocument(restored.document);
        }
      } catch (e) {
        if (!abort.signal.aborted) setError((e as Error).message);
      }
    }
    void start();
    return () => abort.abort();
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const [nextStatus, nextJob] = await Promise.all([
          api<Status>('status', { signal: abort.signal }),
          job?.id ? api<Job>(`jobs/${job.id}`, { signal: abort.signal }) : Promise.resolve(null),
        ]);
        setStatus(nextStatus);
        if (nextJob) setJob(nextJob);
      } catch (e) {
        if (!abort.signal.aborted) setError((e as Error).message);
      }
      if (!abort.signal.aborted) timer = setTimeout(poll, active ? 1000 : 5000);
    }
    timer = setTimeout(poll, 1000);
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [job?.id, active]);

  async function submit() {
    if (active) return;
    setSubmitting(true);
    setError('');
    setReplayed(false);
    // Preserve key across an uncertain HTTP response; never silently create another job.
    if (!request.current || request.current.document !== document)
      request.current = { key: crypto.randomUUID(), document };
    try {
      if (paid && status?.wallet)
        await (await import('../lib/wallet-client')).walletClient(status.wallet);
      const created = await api<{ id: string }>(
        job?.phase === 'awaiting_credits' ? `jobs/${job.id}` : 'jobs',
        {
          method: 'POST',
          body: JSON.stringify(request.current),
        },
      );
      setJob(await api<Job>(`jobs/${created.id}`));
    } catch (e) {
      setError((e as Error).message);
      const latest = await api<Status>('status').catch(() => null);
      if (latest) {
        setStatus(latest);
        if (latest.jobs[0]?.phase === 'awaiting_credits')
          setJob(await api<Job>(`jobs/${latest.jobs[0].id}`));
      }
    } finally {
      setSubmitting(false);
    }
  }
  async function replay() {
    if (!job || replaying) return;
    setReplaying(true);
    try {
      setJob(await api<Job>(`jobs/${job.id}`));
      setReplayed(true);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReplaying(false);
    }
  }

  return (
    <main>
      <header>
        <a
          className="wordmark"
          href="https://github.com/horn111/resvary"
          target="_blank"
          rel="noreferrer"
          aria-label="Resvary source code on GitHub"
        >
          resvary<span> / agent demo</span>
        </a>
        <nav aria-label="Demo network">
          <span className="tag">
            {status ? `ARC ${status.arcEnvironment.toUpperCase()}` : 'CHECKING NETWORK'}
          </span>
        </nav>
      </header>
      <section className="intro">
        <h1>
          An agent pays for
          <br />
          document analysis.
        </h1>
        <p>
          Try three runs free. Then add USDC from your wallet on Arc Mainnet and pay with Resvary
          credits. The agent analyzes your document; Resvary charges measured usage.
        </p>
      </section>
      <div className="notice">
        {!status
          ? 'Checking the demo network and payment configuration.'
          : status.testMode
            ? 'LOCAL TEST MODE · Deterministic analysis and simulated settlement. No real AI or USDC payment.'
            : status?.arcEnvironment === 'mainnet'
              ? 'MAINNET · Three sponsored runs per IP, then prepaid credits from your wallet.'
              : 'Testnet USDC is supplied by the project. Document analysis uses a paid AI provider.'}
      </div>
      <div className="workspace">
        <section className="document panel">
          <div className="section-heading">
            <h2>01 / Document</h2>
            <span>{bytes.toLocaleString()} / 12,288 bytes</span>
          </div>
          <div className="examples">
            {examples.map((example) => (
              <button
                key={example.name}
                disabled={active || job?.phase === 'awaiting_credits'}
                aria-pressed={document === example.text}
                onClick={() => replaceDocument(example.text)}
              >
                {example.name}
              </button>
            ))}
          </div>
          <label htmlFor="document">Choose an example or paste plain text</label>
          <textarea
            id="document"
            value={document}
            onChange={(e) => replaceDocument(e.target.value)}
            disabled={active || job?.phase === 'awaiting_credits'}
            spellCheck={false}
          />
          <div className="run-row">
            <button
              className="primary"
              onClick={submit}
              disabled={
                active || !status?.accepting || !canPay || bytes > 12288 || !document.trim()
              }
            >
              {!status
                ? 'Starting secure session…'
                : active
                  ? 'Agent is working…'
                  : job?.phase === 'awaiting_credits'
                    ? 'Continue pending analysis'
                    : paid
                      ? 'Run with my credits'
                      : 'Run free analysis'}
              <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16">
                <path d="M4 12 12 4M6 4h6v6" />
              </svg>
            </button>
            <div>
              <small>{status?.wallet ? 'Your available credits' : 'Sponsored demo credits'}</small>
              <strong data-testid="balance">{money(status?.balance ?? '0')}</strong>
            </div>
          </div>
          <p className="fine">
            {status
              ? `${status.freeRunsRemaining} of 3 free runs left for this IP. The free allowance does not reset. `
              : ''}
            Text and results expire after 24 hours. Do not submit sensitive information. Reusing the
            same completed request does not charge again.
          </p>
          {status && (paid || status.wallet) ? (
            <WalletPanel
              address={status.wallet}
              balance={status.balance}
              maxAmount={status.maxPaidAmount}
              amounts={status.topUpAmounts}
              accepting={status.accepting}
              refresh={refresh}
            />
          ) : null}
          {status && !status.accepting ? (
            <p role="status" className="message">
              New runs paused. {status.message}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="error">
              {error}
            </p>
          ) : null}
        </section>
        <section className="panel activity" aria-live="polite" aria-busy={active}>
          <div className="section-heading">
            <h2>02 / Execution</h2>
            <span className="tag">
              {job?.phase.replaceAll('_', ' ') ?? (status ? 'Ready' : 'Connecting')}
            </span>
          </div>
          <p className="fine">Observable actions only. No private model reasoning.</p>
          {job?.events.length ? (
            <ol>
              {job.events.map((event, i) => (
                <li key={event.seq} style={{ animationDelay: `${i * 22}ms` }}>
                  <span className="step">{String(i + 1).padStart(2, '0')}</span>
                  <div>
                    {labels[event.kind] ?? event.kind}
                    {event.detail.amount ? (
                      <small>{money(String(event.detail.amount))}</small>
                    ) : null}
                    {event.detail.fundingTransactionId ? (
                      <code>{String(event.detail.fundingTransactionId)}</code>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="empty">
              {status
                ? 'Run a document to see the payment and execution records here.'
                : 'Establishing a secure demo session…'}
            </div>
          )}
          {job?.failure ? <p className="error">{job.failure}</p> : null}
        </section>
      </div>
      <div className="workspace results">
        <section className="panel">
          <div className="section-heading">
            <h2>03 / Analysis</h2>
            {job?.result ? <span className="tag">SAVED RESULT</span> : null}
          </div>
          <div className={job?.result ? 'analysis' : 'empty'}>
            {job?.result ??
              'Summary, key facts and open questions appear after the paid service finishes.'}
          </div>
        </section>
        <section className="panel">
          <div className="section-heading">
            <h2>04 / Receipt</h2>
          </div>
          {job?.receipt ? (
            <>
              <dl>
                <div>
                  <dt>Reserved</dt>
                  <dd>
                    {money(
                      (Number(job.receipt.amountUnits) + Number(job.receipt.releasedUnits)) / 1e6,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Measured product charge</dt>
                  <dd>{money(job.receipt.amount)}</dd>
                </div>
                <div>
                  <dt>Released</dt>
                  <dd>{money(job.receipt.releasedAmount)}</dd>
                </div>
                <div>
                  <dt>Balance after this job</dt>
                  <dd>{money(Number(job.receipt.balanceAfterUnits) / 1e6)}</dd>
                </div>
              </dl>
              <code data-testid="receipt-id">{job.receipt.id}</code>
              <button className="replay" onClick={replay} disabled={replaying}>
                {replaying ? 'Checking saved result…' : 'Replay saved result'}
              </button>
              {replayed ? <p role="status">Same result. Same receipt. No new charge.</p> : null}
            </>
          ) : (
            <div className="empty">
              One receipt links the reservation, measured usage and released credits.
            </div>
          )}
        </section>
      </div>
      <footer>
        ETHOnline 2026 continuity build.
        <br />
        Existing foundation: ledger, pricing and Gateway adapter.
        <br />
        Hackathon addition: agent buyer, durable document jobs and this demo.
      </footer>
    </main>
  );
}
