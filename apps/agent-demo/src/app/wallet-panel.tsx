'use client';
import { useEffect, useState } from 'react';
import type { ArcFundingRequest } from '@resvary/sdk/funding/arc';

type Pending = { id: string; address: string; amount: string; txHash: string };
type Provider = {
  on?: (event: string, action: () => void) => void;
  removeListener?: (event: string, action: () => void) => void;
};
const storageKey = (address: string) => `resvary:arc:topup:${address.toLowerCase()}`;

async function post<T>(path: string, input: object = {}): Promise<T> {
  const response = await fetch(`/api/wallet/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'Wallet request failed');
  return body;
}

export default function WalletPanel({
  address,
  balance,
  maxAmount,
  amounts,
  accepting,
  refresh,
}: {
  address: string | null;
  balance: string;
  maxAmount: string;
  amounts: string[];
  accepting: boolean;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [amount, setAmount] = useState('0.50');
  const [pending, setPending] = useState<Pending | null>(null);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [hash, setHash] = useState('');

  useEffect(() => {
    setPending(null);
    setStorageBlocked(false);
    setHash('');
    if (!address) return;
    try {
      const raw = localStorage.getItem(storageKey(address));
      if (!raw) return;
      const saved = JSON.parse(raw) as Pending;
      if (
        saved.address.toLowerCase() !== address.toLowerCase() ||
        !/^fund_[0-9a-f]{24}$/.test(saved.id)
      )
        throw new Error();
      setPending(saved);
      setHash(saved.txHash);
    } catch {
      setStorageBlocked(true);
      setError(
        'Could not read the pending top-up. Restore browser storage before making another payment.',
      );
    }
  }, [address]);

  useEffect(() => {
    if (!address) return;
    const provider = (window as unknown as { ethereum?: Provider }).ethereum;
    const invalidate = () => {
      void post('disconnect')
        .then(refresh)
        .catch(() => setError('Wallet changed. Reconnect before running a paid analysis.'));
    };
    provider?.on?.('accountsChanged', invalidate);
    return () => provider?.removeListener?.('accountsChanged', invalidate);
  }, [address, refresh]);

  async function connect() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const wallet = await import('../lib/wallet-client');
      const { account } = await wallet.walletClient();
      const challenge = await post<{ address: string; message: string }>('challenge', {
        address: account,
      });
      const signature = await wallet.signWallet(challenge.message, challenge.address);
      await post('verify', { signature });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(saved: Pending, txHash: string) {
    await post(`funding/${saved.id}/confirm`, { txHash });
    localStorage.removeItem(storageKey(saved.address));
    setPending(null);
    setHash('');
    setNotice(`${saved.amount} USDC added to your Resvary credits.`);
    await refresh();
  }

  async function topUp() {
    if (!address || pending || storageBlocked) return;
    setBusy(true);
    setError('');
    setNotice('');
    let saved: Pending | null = null;
    let sent = false;
    try {
      const wallet = await import('../lib/wallet-client');
      await wallet.walletClient(address);
      const invoice = await post<ArcFundingRequest & { chainId: number }>('funding', {
        amount,
        key: crypto.randomUUID(),
      });
      if (invoice.chainId !== 5042) throw new Error('Unexpected payment network');
      saved = { id: invoice.fundingIntent.id, address, amount, txHash: '' };
      // Write before opening the payment prompt. After an uncertain wallet response,
      // the next action verifies this invoice instead of broadcasting another payment.
      localStorage.setItem(storageKey(address), JSON.stringify(saved));
      setPending(saved);
      const txHash = await wallet.sendTopUp(
        address,
        invoice.paymentRequest.memoContract,
        invoice.paymentRequest.txData,
      );
      sent = true;
      saved = { ...saved, txHash };
      setPending(saved);
      setHash(txHash);
      localStorage.setItem(storageKey(address), JSON.stringify(saved));
      await confirm(saved, txHash);
    } catch (e) {
      const code =
        (e as { code?: number; cause?: { code?: number } }).cause?.code ??
        (e as { code?: number }).code;
      if (!sent && code === 4001 && saved) {
        localStorage.removeItem(storageKey(saved.address));
        setPending(null);
      }
      setError(
        sent
          ? 'Payment submitted. Wait for confirmation, then check the transaction below. Do not send it again.'
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    if (!pending) return;
    setBusy(true);
    setError('');
    try {
      await confirm(pending, hash);
    } catch {
      setError(
        'Payment is not verified yet. Check the transaction hash and Arc Mainnet receipt, then retry verification. No new payment was sent.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="wallet-panel" aria-label="Resvary credits">
      <h3>Your Resvary credits</h3>
      <p>
        After three free runs per IP, connect your wallet and add USDC on Arc Mainnet. Credits stay
        with your wallet across sessions.
      </p>
      {address ? (
        <>
          <p>
            <code>{address}</code>
          </p>
          <p>
            Available: <strong>${balance}</strong>
          </p>
          <div className="wallet-actions">
            <label>
              Top-up amount
              <select
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={busy || Boolean(pending)}
              >
                {amounts.map((value) => (
                  <option key={value} value={value}>
                    {value} USDC
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={topUp}
              disabled={busy || !accepting || Boolean(pending) || storageBlocked}
            >
              Add USDC credits
            </button>
            <button
              disabled={busy}
              onClick={() => {
                void post('disconnect')
                  .then(refresh)
                  .catch((e: Error) => setError(e.message));
              }}
            >
              Disconnect
            </button>
          </div>
          {pending ? (
            <div className="pending-payment">
              <p>
                Pending top-up: {pending.amount} USDC. If the wallet response was interrupted, find
                the transaction hash in your wallet activity.
              </p>
              <label>
                Arc transaction hash
                <input
                  value={hash}
                  onChange={(e) => setHash(e.target.value)}
                  placeholder="0x…"
                  disabled={busy}
                />
              </label>
              <button onClick={check} disabled={busy || !/^0x[0-9a-f]{64}$/i.test(hash)}>
                Check payment
              </button>
              {/^0x[0-9a-f]{64}$/i.test(hash) ? (
                <a href={`https://explorer.arc.io/tx/${hash}`} target="_blank" rel="noreferrer">
                  View transaction
                </a>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <button onClick={connect} disabled={busy}>
          {busy ? 'Confirm in your wallet…' : 'Connect wallet'}
        </button>
      )}
      <p className="fine">
        Maximum per paid run: ${maxAmount}. We reserve this amount, charge measured agent and
        analysis tokens ($2 / million input, $8 / million output), then release the remainder to
        your credits. Network fees are separate. Credits are for this service; they are not a
        transferable token.
      </p>
      {notice ? <p role="status">{notice}</p> : null}
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
