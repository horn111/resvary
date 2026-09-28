import { randomBytes } from 'node:crypto';
import { createPublicClient, getAddress, http, type Address, type Hex } from 'viem';
import { createSiweMessage } from 'viem/siwe';
import { ARC_MAINNET } from '@resvary/sdk';
import { ArcCreditFunding, type ArcFundingRequest } from '@resvary/sdk/funding/arc';
import { createReceipt, verifyMemoPaymentProof } from '@resvary/sdk/receipts';
import { InsufficientCreditsError } from '@resvary/sdk/credits';
import { type Runtime, price } from './runtime';
import { DemoError, type Job } from './store';
import { ARC_WALLET_CHAIN } from './wallet-network';
import { TOP_UP_AMOUNTS, walletCustomer } from './billing';

export const arcClient = createPublicClient({
  chain: ARC_WALLET_CHAIN,
  transport: http(ARC_MAINNET.rpcUrl, { timeout: 15_000, retryCount: 1 }),
});

function mainnet(rt: Runtime) {
  if (rt.cfg.arcEnvironment !== 'mainnet')
    throw new DemoError(409, 'Wallet payments require Arc Mainnet');
}
function address(value: unknown): Address {
  try {
    if (typeof value !== 'string') throw new Error();
    return getAddress(value).toLowerCase() as Address;
  } catch {
    throw new DemoError(400, 'Invalid wallet address');
  }
}

export async function connectedWallet(rt: Runtime, owner: string): Promise<Address | null> {
  const row = (
    await rt.pool.query<{ address: Address }>(
      'SELECT address FROM agent_demo.wallet_sessions WHERE customer=$1 AND expires_at>now()',
      [owner],
    )
  ).rows[0];
  return row?.address ?? null;
}

export async function walletActionLimit(rt: Runtime, ipHash: string) {
  const key = `wallet:${new Date().toISOString().slice(0, 13)}:${ipHash}`;
  const count = (
    await rt.pool.query(
      'INSERT INTO agent_demo.quotas(key,used) VALUES($1,1) ON CONFLICT(key) DO UPDATE SET used=agent_demo.quotas.used+1 RETURNING used',
      [key],
    )
  ).rows[0].used;
  if (count > 60) throw new DemoError(429, 'Too many wallet requests. Try again later.');
}

export async function walletChallenge(rt: Runtime, owner: string, value: unknown) {
  mainnet(rt);
  const wallet = address(value);
  const expires = new Date(Date.now() + 5 * 60_000);
  const message = createSiweMessage({
    address: getAddress(wallet),
    chainId: ARC_MAINNET.chainId,
    domain: new URL(rt.cfg.origin).host,
    uri: rt.cfg.origin,
    version: '1',
    nonce: randomBytes(16).toString('hex'),
    issuedAt: new Date(),
    expirationTime: expires,
    statement:
      'Sign in to your Resvary credit balance. This signature does not authorize a payment.',
  });
  await rt.pool.query(
    `INSERT INTO agent_demo.wallet_challenges(customer,address,message,expires_at) VALUES($1,$2,$3,$4)
     ON CONFLICT(customer) DO UPDATE SET address=$2,message=$3,expires_at=$4`,
    [owner, wallet, message, expires],
  );
  return { address: wallet, message };
}

export async function verifyWallet(rt: Runtime, owner: string, signature: unknown) {
  mainnet(rt);
  if (typeof signature !== 'string' || !/^0x[0-9a-f]+$/i.test(signature) || signature.length > 4098)
    throw new DemoError(400, 'Invalid wallet signature');
  // Verify the exact server-generated message, then consume it atomically. A concurrent
  // challenge replacement or replay cannot bind another wallet to the visitor session.
  const row = (
    await rt.pool.query<{ address: Address; message: string }>(
      'SELECT address,message FROM agent_demo.wallet_challenges WHERE customer=$1 AND expires_at>now()',
      [owner],
    )
  ).rows[0];
  if (!row) throw new DemoError(401, 'Wallet challenge expired. Connect again.');
  if ((await arcClient.getChainId()) !== ARC_MAINNET.chainId)
    throw new DemoError(503, 'Arc network identity check failed');
  const code = await arcClient.getCode({ address: row.address });
  // Arc's memo payment predeploy currently supports EOAs. Reject unsupported wallets
  // before offering a top-up instead of accepting a deposit that cannot be executed.
  if (code && code !== '0x')
    throw new DemoError(
      400,
      'Use an EOA browser wallet for Arc memo payments. Smart-contract wallets are not supported.',
    );
  if (
    !(await arcClient.verifyMessage({
      address: row.address,
      message: row.message,
      signature: signature as Hex,
    }))
  )
    throw new DemoError(401, 'Wallet signature did not match');
  await rt.jobs.transaction(async (client) => {
    const consumed = await client.query(
      'DELETE FROM agent_demo.wallet_challenges WHERE customer=$1 AND message=$2 AND expires_at>now() RETURNING address',
      [owner, row.message],
    );
    if (!consumed.rowCount)
      throw new DemoError(401, 'Wallet challenge was already used or expired');
    await client.query(
      `INSERT INTO agent_demo.wallet_sessions(customer,address,expires_at) VALUES($1,$2,now()+interval '24 hours')
       ON CONFLICT(customer) DO UPDATE SET address=$2,expires_at=EXCLUDED.expires_at`,
      [owner, row.address],
    );
  });
  return { address: row.address };
}

export async function disconnectWallet(rt: Runtime, owner: string) {
  await rt.jobs.transaction(async (client) => {
    await client.query('DELETE FROM agent_demo.wallet_sessions WHERE customer=$1', [owner]);
    await client.query('DELETE FROM agent_demo.wallet_challenges WHERE customer=$1', [owner]);
  });
}

export function walletFunding(rt: Runtime) {
  mainnet(rt);
  return new ArcCreditFunding({
    ledger: rt.ledger,
    payTo: rt.cfg.seller,
    networkConfig: ARC_MAINNET,
    publicClient: arcClient,
  });
}

export async function createWalletFunding(
  rt: Runtime,
  wallet: Address,
  amount: unknown,
  key: unknown,
) {
  if (typeof amount !== 'string' || !TOP_UP_AMOUNTS.some((value) => value === amount))
    throw new DemoError(400, 'Choose one of the offered top-up amounts');
  if (typeof key !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(key))
    throw new DemoError(400, 'A UUID top-up key is required');
  const customer = walletCustomer(wallet);
  const request = await walletFunding(rt).createFundingRequest({
    customerId: customer,
    amount,
    idempotencyKey: `wallet-topup:${key}`,
  });
  const saved = (
    await rt.pool.query<{ request: ArcFundingRequest; tx_hash: Hex | null }>(
      `INSERT INTO agent_demo.wallet_funding(id,customer,request) VALUES($1,$2,$3)
     ON CONFLICT(id) DO UPDATE SET id=EXCLUDED.id RETURNING request,tx_hash`,
      [request.fundingIntent.id, customer, JSON.stringify(request)],
    )
  ).rows[0];
  return { ...saved.request, txHash: saved.tx_hash, chainId: ARC_MAINNET.chainId };
}

export async function confirmWalletFunding(
  rt: Runtime,
  wallet: Address,
  id: string,
  hash: unknown,
) {
  if (typeof hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(hash))
    throw new DemoError(400, 'A transaction hash is required');
  const row = (
    await rt.pool.query<{ request: ArcFundingRequest; tx_hash: Hex | null }>(
      'SELECT request,tx_hash FROM agent_demo.wallet_funding WHERE id=$1 AND customer=$2',
      [id, walletCustomer(wallet)],
    )
  ).rows[0];
  if (!row) throw new DemoError(404, 'Top-up not found for this wallet');
  if (row.tx_hash && row.tx_hash.toLowerCase() !== hash.toLowerCase())
    throw new DemoError(
      409,
      'This top-up already has a transaction. Check its status before sending another.',
    );
  const { request } = row;
  // Verify chain, successful receipt, Memo binding and USDC transfer using Core.
  // A caller-provided transaction hash or receipt alone never grants credits.
  const proof = await verifyMemoPaymentProof({
    txHash: hash as Hex,
    paymentRequest: request.paymentRequest,
    publicClient: arcClient,
    network: ARC_MAINNET,
  });
  if (proof.payer.toLowerCase() !== wallet.toLowerCase())
    throw new DemoError(400, 'Payment sender does not match the connected wallet');
  const pinned = await rt.pool.query(
    'UPDATE agent_demo.wallet_funding SET tx_hash=$3 WHERE id=$1 AND customer=$2 AND (tx_hash IS NULL OR lower(tx_hash)=lower($3)) RETURNING id',
    [id, walletCustomer(wallet), hash],
  );
  if (!pinned.rowCount)
    throw new DemoError(409, 'A different transaction already funds this top-up');
  const receipt = createReceipt(request.invoice, {
    from: wallet,
    to: rt.cfg.seller,
    amount: request.fundingIntent.requestedAmount,
    memo: request.invoice.memo,
    txHash: hash as Hex,
  });
  receipt.id = `rcpt_${id}`;
  const result = await walletFunding(rt).confirmPayment({
    fundingIntentId: id,
    receipt,
    idempotencyKey: `wallet-confirm:${id}`,
  });
  return {
    confirmed: true,
    fundingTransactionId: result.fundingTransaction.id,
    amount: result.fundingTransaction.amount,
    txHash: hash,
  };
}

export async function reservePaidJob(
  rt: Runtime,
  job: Job,
  wallet: Address | null,
  accepting: boolean,
) {
  if (job.billing_mode !== 'paid') return job;
  if (!wallet || job.billing_customer !== walletCustomer(wallet))
    throw new DemoError(401, 'Connect the wallet used for this request');
  if (job.phase !== 'awaiting_credits') return job;
  if (!accepting) throw new DemoError(503, 'New runs are paused');
  const pricing = await price(rt.ledger);
  let reservation;
  try {
    reservation = await rt.ledger.reserveCredits({
      customerId: job.billing_customer,
      priceId: pricing.id,
      estimatedUsage: job.estimated,
      idempotencyKey: `reserve:${job.id}`,
      expiresAt: job.expires_at.getTime(),
    });
  } catch (error) {
    if (error instanceof InsufficientCreditsError)
      throw new DemoError(
        402,
        'Add USDC credits to cover the displayed maximum, then retry this request.',
      );
    throw error;
  }
  const current = await rt.ledger.getReservation(reservation.id);
  if (!current || current.status !== 'open' || current.expiresAt <= Date.now())
    throw new DemoError(409, 'This reservation is closed. Start a new request.');
  await rt.pool.query(
    "UPDATE agent_demo.jobs SET reservation_id=$2 WHERE id=$1 AND phase='awaiting_credits'",
    [job.id, reservation.id],
  );
  // Activation is idempotent and alone allocates the provider budget and queues work.
  // If admission pauses between reservation and activation, keep the request pending;
  // retrying it reuses the same reservation rather than making another charge.
  return rt.jobs.activatePaid(job.id, reservation.id, accepting);
}
