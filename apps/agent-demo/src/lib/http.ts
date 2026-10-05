import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { GatewayPaymentPayload } from '@resvary/circle';
import { runtime } from './runtime';
import { authorizePayment, boundedJson, customer, ipKey, newSession, sameOrigin } from './auth';
import { DemoError } from './store';
import { funding } from './payments';
import { RUN_BUDGET_UNITS } from './config';
import { demoReadiness } from './readiness';
import { dispatchJob, drainDispatches } from './workflow-dispatch';
import { recoverWorkflowJob } from './workflow-execution';
import { buildInfo } from './build-info';
import { operationsHealth } from './operations-health';
import {
  connectedWallet,
  releaseExpiredWalletHolds,
  walletActionLimit,
  walletChallenge,
  verifyWallet,
  disconnectWallet,
  createWalletFunding,
  confirmWalletFunding,
  reservePaidJob,
} from './wallet';
import { FREE_RUNS_PER_IP, PAID_MAX_AMOUNT, TOP_UP_AMOUNTS, walletCustomer } from './billing';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', ...headers } });

async function payment(request: Request, id: string) {
  const rt = runtime();
  authorizePayment(request, id, rt.cfg.secret);
  const job = await rt.jobs.get(id);
  if (job.billing_mode === 'paid')
    throw new DemoError(403, 'Visitor-funded jobs cannot spend the sponsor wallet');
  if (
    !job.challenge ||
    !['payment_pending', 'funded', 'review_required', 'completed'].includes(job.phase)
  )
    throw new DemoError(409, 'No payable challenge');
  const intent = job.challenge.fundingIntent;
  if (intent.customerId !== job.customer) throw new DemoError(409, 'Funding context mismatch');
  const paid = await rt.ledger.listFundingTransactions(intent.id);
  if (paid.length)
    return json({ funded: true, fundingIntentId: intent.id, fundingTransactionId: paid[0].id });
  const signature = request.headers.get('payment-signature');
  if (!signature) {
    if (job.phase !== 'payment_pending') throw new DemoError(409, 'Payment needs reconciliation');
    return json(job.challenge.paymentRequired, 402, {
      'PAYMENT-REQUIRED': Buffer.from(JSON.stringify(job.challenge.paymentRequired)).toString(
        'base64',
      ),
    });
  }
  if (signature.length > 24_000) throw new DemoError(413, 'Payment header too large');
  let payload: GatewayPaymentPayload;
  try {
    payload = JSON.parse(Buffer.from(signature, 'base64').toString('utf8'));
  } catch {
    throw new DemoError(400, 'Invalid payment payload');
  }
  const auth = payload?.payload?.authorization;
  if (
    auth?.from?.toLowerCase() !== rt.cfg.payer ||
    auth.to?.toLowerCase() !== rt.cfg.seller ||
    auth.value !== intent.requestedUnits ||
    payload.accepted?.extra?.resvaryFundingIntentId !== intent.id ||
    typeof auth.nonce !== 'string' ||
    !/^0x[0-9a-f]{64}$/i.test(auth.nonce) ||
    typeof auth.validBefore !== 'string' ||
    !/^\d{1,16}$/.test(auth.validBefore)
  )
    throw new DemoError(400, 'Payment context mismatch');
  // Persist before contacting the facilitator. Unknown outcomes forbid a new authorization.
  const hash = createHash('sha256').update(JSON.stringify(auth)).digest('hex');
  const inserted = await rt.pool.query(
    'INSERT INTO agent_demo.authorizations(job_id,hash,nonce,valid_before) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING hash',
    [id, hash, auth.nonce, auth.validBefore],
  );
  if (!inserted.rowCount)
    throw new DemoError(
      409,
      'Existing authorization requires reconciliation; automatic settlement retry disabled',
    );
  const result = await funding(rt, id)
    .verifySettleAndCredit({
      fundingIntentId: intent.id,
      paymentPayload: payload,
      idempotencyKey: `payment:${id}`,
    })
    .catch(async (error: unknown) => {
      const message = error instanceof Error ? error.message : '';
      const reason =
        message === 'Gateway accepted requirements differ from the funding request'
          ? 'requirements_mismatch'
          : /^Circle Gateway verification failed: [a-z_]{1,64}$/.test(message)
            ? message.split(': ')[1]
            : 'unknown_payment_outcome';
      // Only fixed error codes and non-secret identifiers enter the event log.
      await rt.jobs.event(id, 'payment_error', { reason });
      throw error;
    });
  return json(
    {
      funded: true,
      fundingIntentId: intent.id,
      fundingTransactionId: result.fundingTransaction.id,
    },
    200,
    { 'PAYMENT-RESPONSE': Buffer.from(JSON.stringify(result.settlement)).toString('base64') },
  );
}

async function maintenance(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get('authorization') ?? '';
  if (
    !secret ||
    secret.length < 32 ||
    !timingSafeEqual(
      createHash('sha256').update(authorization).digest(),
      createHash('sha256').update(`Bearer ${secret}`).digest(),
    )
  )
    throw new DemoError(401, 'Unauthorized maintenance request');
  const rt = runtime();
  const token = randomUUID();
  const claim = await rt.pool.query(
    `UPDATE agent_demo.maintenance SET lease_token=$1,lease_expires_at=now()+interval '6 minutes',
      last_started_at=now() WHERE id=1 AND (lease_expires_at IS NULL OR lease_expires_at<now()) RETURNING id`,
    [token],
  );
  if (!claim.rowCount) return json({ ok: true, skipped: 'maintenance_in_progress' });
  try {
    const cleaned = await rt.jobs.cleanup();
    await rt.ledger.releaseExpiredReservations({
      idempotencyKey: `expired:${Date.now()}`,
      limit: 100,
    });
    let dispatched = 0;
    let reconciled = 0;
    if (rt.cfg.executionMode === 'workflow') {
      await rt.jobs.reconcileWorkflows();
      const saved = await rt.pool.query<{ id: string }>(
        "SELECT id FROM agent_demo.jobs WHERE phase='result_saved' AND expires_at>now() LIMIT 25",
      );
      for (const job of saved.rows) await recoverWorkflowJob(rt, job.id);
      dispatched = await drainDispatches(rt);
      reconciled = saved.rowCount ?? 0;
    }
    await rt.pool.query(
      `UPDATE agent_demo.maintenance SET last_succeeded_at=now(),cleaned_jobs=$2,
      lease_token=NULL,lease_expires_at=NULL WHERE id=1 AND lease_token=$1`,
      [token, cleaned],
    );
    console.info(
      JSON.stringify({
        event: 'maintenance.completed',
        cleaned,
        dispatched,
        reconciled,
        build: buildInfo(),
      }),
    );
    return json({ ok: true, cleaned, dispatched, reconciled, build: buildInfo() });
  } catch (error) {
    await rt.pool.query(
      `UPDATE agent_demo.maintenance SET last_failed_at=now(),lease_token=NULL,lease_expires_at=NULL
        WHERE id=1 AND lease_token=$1`,
      [token],
    );
    console.error(JSON.stringify({ event: 'maintenance.failed', build: buildInfo() }));
    throw error;
  }
}

export async function handle(request: Request) {
  try {
    const path = new URL(request.url).pathname;
    if (path === '/api/version' && request.method === 'GET') return json(buildInfo());
    if (path === '/api/health' && request.method === 'GET') {
      try {
        const health = await operationsHealth(runtime());
        return json(health, health.ok ? 200 : 503);
      } catch {
        return json({ ok: false, build: buildInfo(), issues: ['operations_unavailable'] }, 503);
      }
    }
    if (path === '/api/internal/maintenance' && request.method === 'GET')
      return await maintenance(request);
    const internal = /^\/api\/internal\/topup\/([0-9a-f-]+)$/i.exec(path);
    if (internal && request.method === 'POST') return await payment(request, internal[1]);
    const rt = runtime();
    if (request.method === 'POST') sameOrigin(request, rt.cfg.origin);
    if (path === '/api/session' && request.method === 'POST') {
      try {
        customer(request, rt.cfg.secret);
        return json({ ok: true });
      } catch {
        /* Expired or absent session. */
      }
      return json({ ok: true }, 200, {
        'Set-Cookie': `resvary_agent=${newSession(rt.cfg.secret)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${rt.cfg.origin.startsWith('https:') ? '; Secure' : ''}`,
      });
    }
    const owner = customer(request, rt.cfg.secret);
    const ip = ipKey(request, rt.cfg.secret, rt.cfg.trustedIpHeader);
    if (path.startsWith('/api/wallet/') && request.method === 'POST') {
      await walletActionLimit(rt, ip);
      if (path === '/api/wallet/disconnect') {
        await disconnectWallet(rt, owner);
        return json({ ok: true });
      }
      const input = await boundedJson(request);
      if (path === '/api/wallet/challenge')
        return json(await walletChallenge(rt, owner, input.address));
      if (path === '/api/wallet/verify')
        return json(await verifyWallet(rt, owner, input.signature));
      const wallet = await connectedWallet(rt, owner);
      if (!wallet) throw new DemoError(401, 'Connect and sign in with your wallet');
      if (path === '/api/wallet/funding') {
        const status = await demoReadiness(rt, true);
        if (!rt.cfg.accepting || !status.workerReady || status.remainingUnits < RUN_BUDGET_UNITS)
          throw new DemoError(503, 'Top-ups are paused while new runs are unavailable');
        return json(await createWalletFunding(rt, wallet, input.amount, input.key));
      }
      const confirmation = /^\/api\/wallet\/funding\/(fund_[0-9a-f]{24})\/confirm$/.exec(path);
      if (confirmation)
        return json(await confirmWalletFunding(rt, wallet, confirmation[1], input.txHash));
      throw new DemoError(404, 'Not found');
    }
    if (path === '/api/status' && request.method === 'GET') {
      await rt.ledger.ensureAccount({ customerId: owner, idempotencyKey: `account:${owner}` });
      const [freeRunsRemaining, wallet] = await Promise.all([
        rt.jobs.freeRunsRemaining(ip),
        connectedWallet(rt, owner),
      ]);
      if (wallet) {
        await rt.ledger.ensureAccount({
          customerId: walletCustomer(wallet),
          idempotencyKey: `account:${walletCustomer(wallet)}`,
        });
        await releaseExpiredWalletHolds(rt);
      }
      const [status, balance, jobs] = await Promise.all([
        demoReadiness(rt, freeRunsRemaining === 0),
        rt.ledger.getBalance(wallet ? walletCustomer(wallet) : owner),
        rt.jobs.list(owner),
      ]);
      return json({
        ...status,
        build: buildInfo(),
        accepting:
          rt.cfg.accepting && status.workerReady && status.remainingUnits >= RUN_BUDGET_UNITS,
        balance: balance.availableAmount,
        wallet,
        freeRunsRemaining,
        freeRunLimit: FREE_RUNS_PER_IP,
        maxPaidAmount: PAID_MAX_AMOUNT,
        topUpAmounts: TOP_UP_AMOUNTS,
        jobs,
        testMode: rt.cfg.testMode,
        arcEnvironment: rt.cfg.arcEnvironment,
      });
    }
    if (path === '/api/jobs' && request.method === 'POST') {
      const input = await boundedJson(request);
      if (typeof input.document !== 'string' || typeof input.key !== 'string')
        throw new DemoError(400, 'Document and request key are required');
      const [remaining, wallet] = await Promise.all([
        rt.jobs.freeRunsRemaining(ip),
        connectedWallet(rt, owner),
      ]);
      const status = await demoReadiness(rt, remaining === 0);
      let job = await rt.jobs.create(
        owner,
        input.key,
        input.document,
        ip,
        rt.cfg.accepting && status.workerReady,
        wallet ?? undefined,
      );
      job = await reservePaidJob(rt, job, wallet, rt.cfg.accepting && status.workerReady);
      if (rt.cfg.executionMode === 'workflow') await dispatchJob(rt, job.id);
      return json({ id: job.id, phase: job.phase }, 202);
    }
    const match = /^\/api\/jobs\/([0-9a-f-]+)$/i.exec(path);
    if (match && request.method === 'POST') {
      const status = await demoReadiness(rt, true);
      const job = await reservePaidJob(
        rt,
        await rt.jobs.get(match[1], owner),
        await connectedWallet(rt, owner),
        rt.cfg.accepting && status.workerReady,
      );
      if (rt.cfg.executionMode === 'workflow') await dispatchJob(rt, job.id);
      return json({ id: job.id, phase: job.phase }, 202);
    }
    if (match && request.method === 'GET') {
      const job = await rt.jobs.get(match[1], owner);
      return json({
        id: job.id,
        phase: job.phase,
        document: job.phase === 'awaiting_credits' ? job.document : undefined,
        result: job.phase === 'completed' ? job.result : null,
        receipt: job.receipt,
        usage: job.usage,
        failure: job.failure,
        events: await rt.jobs.events(job.id),
      });
    }
    throw new DemoError(404, 'Not found');
  } catch (error) {
    return json(
      {
        error:
          error instanceof DemoError
            ? error.message
            : 'Service unavailable. No automatic payment or analysis retry.',
      },
      error instanceof DemoError ? error.status : 503,
    );
  }
}
