import { createHash, timingSafeEqual } from 'node:crypto';
import type { GatewayPaymentPayload } from '@resvary/circle';
import { runtime } from './runtime';
import { authorizePayment, boundedJson, customer, ipKey, newSession, sameOrigin } from './auth';
import { DemoError } from './store';
import { funding } from './payments';
import { RUN_BUDGET_UNITS } from './config';
import { demoReadiness } from './readiness';
import { dispatchJob, drainDispatches } from './workflow-dispatch';
import { recoverWorkflowJob } from './workflow-execution';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', ...headers } });

async function payment(request: Request, id: string) {
  const rt = runtime();
  authorizePayment(request, id, rt.cfg.secret);
  const job = await rt.jobs.get(id);
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
  await rt.jobs.cleanup();
  if (rt.cfg.executionMode !== 'workflow') return json({ ok: true });
  await rt.jobs.reconcileWorkflows();
  const saved = await rt.pool.query<{ id: string }>(
    "SELECT id FROM agent_demo.jobs WHERE phase='result_saved' AND expires_at>now() LIMIT 25",
  );
  for (const job of saved.rows) await recoverWorkflowJob(rt, job.id);
  const dispatched = await drainDispatches(rt);
  return json({ ok: true, dispatched, reconciled: saved.rowCount });
}

export async function handle(request: Request) {
  try {
    const path = new URL(request.url).pathname;
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
    if (path === '/api/status' && request.method === 'GET') {
      await rt.ledger.ensureAccount({ customerId: owner, idempotencyKey: `account:${owner}` });
      const [status, balance, jobs] = await Promise.all([
        demoReadiness(rt),
        rt.ledger.getBalance(owner),
        rt.jobs.list(owner),
      ]);
      return json({
        ...status,
        accepting:
          rt.cfg.accepting && status.workerReady && status.remainingUnits >= RUN_BUDGET_UNITS,
        balance: balance.availableAmount,
        jobs,
        testMode: rt.cfg.testMode,
      });
    }
    if (path === '/api/jobs' && request.method === 'POST') {
      const input = await boundedJson(request);
      if (typeof input.document !== 'string' || typeof input.key !== 'string')
        throw new DemoError(400, 'Document and request key are required');
      const status = await demoReadiness(rt);
      const job = await rt.jobs.create(
        owner,
        input.key,
        input.document,
        ipKey(request, rt.cfg.secret, rt.cfg.trustedIpHeader),
        rt.cfg.accepting && status.workerReady,
      );
      if (rt.cfg.executionMode === 'workflow') await dispatchJob(rt, job.id);
      return json({ id: job.id, phase: job.phase }, 202);
    }
    const match = /^\/api\/jobs\/([0-9a-f-]+)$/i.exec(path);
    if (match && request.method === 'GET') {
      const job = await rt.jobs.get(match[1], owner);
      return json({
        id: job.id,
        phase: job.phase,
        result: job.result,
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
