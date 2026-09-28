'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { MeteredOperationStatus } from '@resvary/sdk/credits';
import { formatUnits } from '@/lib/format';

const choices = {
  result_saved: {
    action: 'settle_operation',
    label: 'Settle saved usage',
    consequence:
      'Charge the saved usage against its hold. If the hold is no longer valid, the operation will require reconciliation.',
  },
  needs_reconciliation: {
    action: 'reconcile_operation',
    label: 'Reconcile saved usage',
    consequence:
      'Release any remaining original hold, reserve the measured charge, and settle it. Insufficient credits leave this operation unresolved.',
  },
  running: {
    action: 'mark_operation_unknown',
    label: 'Mark outcome unknown',
    consequence:
      'Record that the worker stopped without a known result. This does not cancel the provider request or release the hold.',
  },
  outcome_unknown: {
    action: 'confirm_not_executed',
    label: 'Confirm no execution',
    consequence:
      'Cancel this operation and release an open hold only after external evidence confirms the provider did not execute it.',
  },
} as const;

export function OperationRecoveryForm({
  operationKey,
  status,
  resultHash,
  amountUnits,
  disabled,
}: {
  operationKey: string;
  status: MeteredOperationStatus;
  resultHash?: string;
  amountUnits?: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const choice = status in choices ? choices[status as keyof typeof choices] : undefined;
  const [prepared, setPrepared] = useState<{
    actionId: string;
    reason: string;
    evidenceReference: string;
  }>();
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  if (!choice) return <p className="readonly-note">No recovery action is needed in this state.</p>;

  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPrepared({
      actionId: crypto.randomUUID(),
      reason: String(data.get('reason')).trim(),
      evidenceReference: String(data.get('evidenceReference') ?? '').trim(),
    });
    setMessage('');
    setError(false);
  }

  async function confirm() {
    if (!prepared || !choice) return;
    setPending(true);
    setSubmitted(true);
    setMessage('');
    try {
      const response = await fetch('/api/operator', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...prepared, action: choice.action, operationKey, resultHash }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Recovery failed');
      setError(false);
      setMessage(
        data.result?.resolved
          ? `Recorded as ${prepared.actionId}. Operation resolved.`
          : `Recorded as ${prepared.actionId}. Operation remains unresolved; review its current state.`,
      );
      router.refresh();
    } catch (failure) {
      setError(true);
      setMessage(
        `${failure instanceof Error ? failure.message : 'Response unavailable'}. Retry this command to check the same action ID.`,
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="operator-form operation-recovery" onSubmit={prepare}>
      <header>
        <h3>{choice.label}</h3>
        <p>{choice.consequence}</p>
      </header>
      <p>No recovery action calls the AI provider.</p>
      {amountUnits !== undefined && (
        <p>
          Measured charge <strong>{formatUnits(amountUnits)}</strong>
        </p>
      )}
      <label>
        Reason
        <textarea
          name="reason"
          required
          minLength={8}
          maxLength={500}
          disabled={disabled || Boolean(prepared)}
          placeholder="Reference the incident and why this action is safe"
        />
      </label>
      {status === 'outcome_unknown' && (
        <label>
          External evidence reference
          <input
            name="evidenceReference"
            required
            maxLength={500}
            disabled={disabled || Boolean(prepared)}
            placeholder="Provider lookup or incident reference"
          />
        </label>
      )}
      {prepared && (
        <div className="recovery-preview">
          <p>{choice.consequence}</p>
          <p>
            Action ID <code>{prepared.actionId}</code>
          </p>
          <p>{prepared.reason}</p>
          {prepared.evidenceReference && <p>Evidence: {prepared.evidenceReference}</p>}
        </div>
      )}
      {message && (
        <p className="action-message" role={error ? 'alert' : 'status'}>
          {message}
        </p>
      )}
      {disabled ? (
        <p className="readonly-note">Recovery is disabled in the public demo.</p>
      ) : prepared ? (
        <>
          <button type="button" disabled={pending || (submitted && !error)} onClick={confirm}>
            {pending
              ? 'Recording…'
              : submitted && error
                ? 'Retry same command'
                : `Confirm: ${choice.label.toLowerCase()}`}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setPrepared(undefined);
              setSubmitted(false);
              setMessage('');
            }}
          >
            {submitted ? 'Prepare a new command' : 'Edit reason'}
          </button>
        </>
      ) : (
        <button type="submit">Review recovery action</button>
      )}
    </form>
  );
}
