'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

type Result = { error?: string; action?: { id: string; status: string } };

async function runAction(payload: Record<string, unknown>, actionId: string): Promise<Result> {
  const response = await fetch('/api/operator', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...payload, actionId }),
  });
  const result = (await response.json()) as Result;
  if (!response.ok) throw new Error(result.error ?? 'Operator action failed');
  return result;
}

export function GrantForm({
  customerId,
  availableUnits,
  disabled,
}: {
  customerId: string;
  availableUnits: string;
  disabled: boolean;
}) {
  return (
    <CreditActionForm
      action="grant"
      customerId={customerId}
      title="Manual grant"
      description="Add a positive, non-expiring manual credit lot."
      disabled={disabled}
      positiveOnly
      availableUnits={availableUnits}
    />
  );
}

export function AdjustmentForm({
  customerId,
  availableUnits,
  disabled,
}: {
  customerId: string;
  availableUnits: string;
  disabled: boolean;
}) {
  return (
    <CreditActionForm
      action="adjust"
      customerId={customerId}
      title="Balance adjustment"
      description="Preview the resulting available balance before recording a signed correction."
      disabled={disabled}
      availableUnits={availableUnits}
    />
  );
}

function CreditActionForm({
  action,
  customerId,
  title,
  description,
  disabled,
  positiveOnly = false,
  availableUnits,
}: {
  action: 'grant' | 'adjust';
  customerId: string;
  title: string;
  description: string;
  disabled: boolean;
  positiveOnly?: boolean;
  availableUnits?: string;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<{ current: bigint; delta: bigint; result: bigint }>();
  const [actionId, setActionId] = useState<string>();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    const data = new FormData(event.currentTarget);
    try {
      const delta = decimalToUnits(String(data.get('amount')));
      if (delta === 0n || (positiveOnly && delta < 0n))
        throw new Error(
          positiveOnly ? 'Grant amount must be positive.' : 'Adjustment cannot be zero.',
        );
      const current = BigInt(availableUnits ?? '0');
      const result = action === 'grant' ? current + delta : current + delta;
      if (result < 0n) throw new Error('The resulting available balance cannot be negative.');
      setPreview({ current, delta, result });
      setActionId(crypto.randomUUID());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Invalid amount');
    }
  }

  async function confirm(form: HTMLFormElement) {
    const data = new FormData(form);
    setPending(true);
    setMessage('');
    try {
      const requestId = actionId ?? crypto.randomUUID();
      setActionId(requestId);
      const result = await runAction(
        {
          action,
          customerId,
          amount: data.get('amount'),
          reason: data.get('reason'),
        },
        requestId,
      );
      setMessage(`Recorded as ${result.action?.id ?? 'operator action'}.`);
      setPreview(undefined);
      setActionId(undefined);
      form.reset();
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Operator action failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="operator-form"
      onSubmit={prepare}
      onChange={() => {
        setPreview(undefined);
        setActionId(undefined);
      }}
    >
      <header>
        <h3>{title}</h3>
        <p>{description}</p>
      </header>
      <label>
        Amount (USD)
        <input
          name="amount"
          inputMode="decimal"
          placeholder={positiveOnly ? '25.00' : '-3.50'}
          required
          disabled={disabled || pending}
        />
      </label>
      <label>
        Reason
        <textarea
          name="reason"
          minLength={8}
          maxLength={500}
          required
          placeholder="Reference the incident or support case"
          disabled={disabled || pending}
        />
      </label>
      {preview ? (
        <div className="action-preview">
          <span>
            Current <strong>{formatUnits(preview.current)}</strong>
          </span>
          <span>
            Change <strong>{formatUnits(preview.delta)}</strong>
          </span>
          <span>
            Result <strong>{formatUnits(preview.result)}</strong>
          </span>
          <span>
            Action ID <code>{actionId}</code>
          </span>
        </div>
      ) : null}
      {message ? (
        <p className="action-message" role="status">
          {message}
        </p>
      ) : null}
      {disabled ? (
        <p className="readonly-note">Disabled in public demo mode.</p>
      ) : preview ? (
        <button
          type="button"
          disabled={pending}
          onClick={(event) => confirm(event.currentTarget.form!)}
        >
          {pending ? 'Recording…' : `Confirm ${title.toLowerCase()}`}
        </button>
      ) : (
        <button type="submit">Preview result</button>
      )}
    </form>
  );
}

export function SweepForm({ overdueCount, disabled }: { overdueCount: number; disabled: boolean }) {
  return (
    <SimpleActionForm
      action="expire_overdue"
      title="Expiry sweep"
      target={`${overdueCount} overdue reservation${overdueCount === 1 ? '' : 's'}`}
      button="Expire overdue reservations"
      disabled={disabled}
    />
  );
}

export function RequeueForm({ eventId, disabled }: { eventId: string; disabled: boolean }) {
  return (
    <SimpleActionForm
      action="requeue"
      title="Dead-letter recovery"
      target={eventId}
      button="Requeue event"
      eventId={eventId}
      disabled={disabled}
    />
  );
}

function SimpleActionForm({
  action,
  title,
  target,
  button,
  eventId,
  disabled,
}: {
  action: 'expire_overdue' | 'requeue';
  title: string;
  target: string;
  button: string;
  eventId?: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [actionId, setActionId] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setMessage('');
    try {
      const requestId = actionId ?? crypto.randomUUID();
      setActionId(requestId);
      const result = await runAction(
        {
          action,
          eventId,
          reason: data.get('reason'),
        },
        requestId,
      );
      setMessage(`Recorded as ${result.action?.id ?? 'operator action'}.`);
      setActionId(undefined);
      form.reset();
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Operator action failed');
    } finally {
      setPending(false);
    }
  }
  return (
    <form
      className="simple-action"
      onSubmit={submit}
      onChange={() => {
        setActionId(undefined);
        setMessage('');
      }}
    >
      <div>
        <h3>{title}</h3>
        <code>{target}</code>
      </div>
      <label>
        Reason
        <input
          name="reason"
          minLength={8}
          maxLength={500}
          required
          placeholder="Why is this recovery safe now?"
          disabled={disabled || pending}
        />
      </label>
      {message ? (
        <p role="status" className="action-message">
          {message}
        </p>
      ) : null}
      <button disabled={disabled || pending}>
        {disabled ? 'Read-only demo' : pending ? 'Recording…' : button}
      </button>
    </form>
  );
}

function decimalToUnits(value: string): bigint {
  const match = value.trim().match(/^(-?)(\d+)(?:\.(\d{1,6}))?$/);
  if (!match) throw new Error('Use a decimal amount with no more than six places.');
  const [, sign, whole, fraction = ''] = match;
  const units = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  return sign ? -units : units;
}

function formatUnits(units: bigint): string {
  const sign = units < 0n ? '-' : units > 0n ? '+' : '';
  const value = units < 0n ? -units : units;
  return `${sign}$${value / 1_000_000n}.${(value % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '').padEnd(2, '0')}`;
}
