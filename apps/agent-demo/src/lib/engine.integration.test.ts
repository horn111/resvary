import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { migratePostgres } from '@resvary/postgres';
import { createRuntime, price, type Runtime } from './runtime';
import { JobEngine, ProviderRejected, analyzeFixture } from './engine';
import { RUN_BUDGET_UNITS } from './config';
import { JobStore } from './store';
import { handle } from './http';
import { paymentToken } from './auth';
import { executeWorkflowJob, recoverWorkflowJob } from './workflow-execution';

const database = process.env.TEST_DATABASE_URL;
describe.skipIf(!database)('durable document jobs on PostgreSQL', () => {
  let rt: Runtime;
  const make = (
    owner = `test_${randomUUID()}`,
    key: string = randomUUID(),
    text = 'A short test document.',
  ) => rt.jobs.create(owner, key, text, randomUUID(), true);
  beforeAll(async () => {
    // This suite resets only its dedicated disposable database's demo bookkeeping.
    if (!new URL(database!).pathname.endsWith('_test'))
      throw new Error('TEST_DATABASE_URL must name a dedicated database ending in _test');
    Object.assign(process.env, {
      DATABASE_URL: database,
      AGENT_DEMO_SECRET: 'local-fixture-secret-not-for-production',
      AGENT_DEMO_ORIGIN: 'http://127.0.0.1:3100',
      AGENT_DEMO_TEST_MODE: 'true',
      AGENT_DEMO_ACCEPTING: 'true',
      AGENT_DEMO_PAYER: '0x2222222222222222222222222222222222222222',
      AGENT_DEMO_SELLER: '0x1111111111111111111111111111111111111111',
    });
    rt = createRuntime();
    (globalThis as typeof globalThis & { agentDemoRuntime?: Runtime }).agentDemoRuntime = rt;
    await migratePostgres({ pool: rt.pool });
    await rt.jobs.migrate();
    await price(rt.ledger);
  });
  beforeEach(async () => {
    await rt.pool.query(
      'TRUNCATE agent_demo.events,agent_demo.authorizations,agent_demo.jobs,agent_demo.quotas',
    );
    await rt.pool.query('UPDATE agent_demo.budget SET allocated=0 WHERE id=1');
    await rt.pool.query(
      'UPDATE agent_demo.executor SET job_id=NULL,token=NULL,started_at=NULL WHERE id=1',
    );
  });
  afterAll(async () => {
    await rt?.pool.end();
  });
  it('funds once, charges usage below the quote, replays and spends remaining credits', async () => {
    const owner = randomUUID(),
      first = await make(
        owner,
        randomUUID(),
        'A document with a quoted delivery date. '.repeat(20),
      );
    const analyze = vi.fn(analyzeFixture),
      engine = new JobEngine(rt, analyze);
    await engine.run(first.id);
    const done = await rt.jobs.get(first.id);
    expect(done.phase).toBe('completed');
    expect(Number(done.receipt?.releasedAmount)).toBeGreaterThan(0);
    expect(await rt.ledger.listFundingTransactions(done.challenge!.fundingIntent.id)).toHaveLength(
      1,
    );
    await engine.execute(first.id);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect((await rt.jobs.get(first.id)).receipt).toEqual(done.receipt);
    const second = await make(owner);
    await engine.run(second.id);
    expect((await rt.jobs.get(second.id)).challenge).toBeNull();
    expect(analyze).toHaveBeenCalledTimes(2);
  });
  it('atomically deduplicates creation and claim; conflicting content is rejected', async () => {
    const owner = randomUUID(),
      key = randomUUID();
    const [a, b] = await Promise.all([make(owner, key), make(owner, key)]);
    expect(a.id).toBe(b.id);
    await expect(make(owner, key, 'different')).rejects.toMatchObject({ status: 409 });
    const claimed = await Promise.all([rt.jobs.claim(), rt.jobs.claim()]);
    expect(claimed.filter(Boolean)).toHaveLength(1);
    expect((await rt.jobs.status()).remainingUnits).toBe(10_000_000 - RUN_BUDGET_UNITS);
  });
  it('serializes concurrent session quotas and does not consume quota on replay', async () => {
    const owner = randomUUID();
    const outcomes = await Promise.allSettled(Array.from({ length: 6 }, () => make(owner)));
    expect(outcomes.filter((x) => x.status === 'fulfilled')).toHaveLength(3);
    const job = (
      outcomes.find((x) => x.status === 'fulfilled') as PromiseFulfilledResult<
        Awaited<ReturnType<typeof make>>
      >
    ).value;
    expect((await make(owner, job.request_key)).id).toBe(job.id);
  });
  it('atomically caps IP quota across sessions', async () => {
    const ip = randomUUID();
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        rt.jobs.create(randomUUID(), randomUUID(), 'test', ip, true),
      ),
    );
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(10);
  });
  it('reserves the shared budget before external calls and persists it', async () => {
    await rt.pool.query('UPDATE agent_demo.budget SET allocated=ceiling-$1 WHERE id=1', [
      RUN_BUDGET_UNITS,
    ]);
    const results = await Promise.allSettled([make(), make()]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect((await new JobStore(rt.pool).status()).remainingUnits).toBe(0);
  });
  it('releases the credit reserve on a confirmed provider rejection', async () => {
    const job = await make(),
      analyze = vi.fn(async () => {
        throw new ProviderRejected('Provider rejected request');
      });
    await new JobEngine(rt, analyze).run(job.id);
    const failed = await rt.jobs.get(job.id);
    expect(failed.phase).toBe('failed');
    expect((await rt.ledger.getBalance(job.customer)).availableAmount).toBe(
      failed.challenge?.fundingIntent.requestedAmount,
    );
  });
  it('does not rerun an unknown provider outcome', async () => {
    const job = await make(),
      analyze = vi.fn(async () => {
        throw new Error('timeout');
      });
    const engine = new JobEngine(rt, analyze);
    await engine.run(job.id);
    await engine.run(job.id);
    expect((await rt.jobs.get(job.id)).phase).toBe('review_required');
    expect(analyze).toHaveBeenCalledTimes(1);
  });
  it('commits a saved result after failure without invoking the provider again', async () => {
    const job = await make(),
      analyze = vi.fn(analyzeFixture),
      engine = new JobEngine(rt, analyze);
    const commit = vi
      .spyOn(rt.ledger, 'commitUsage')
      .mockRejectedValueOnce(new Error('db unavailable'));
    await engine.run(job.id);
    expect((await rt.jobs.get(job.id)).phase).toBe('result_saved');
    await new JobEngine(rt, analyze).commit(await rt.jobs.get(job.id));
    const receipt = (await rt.jobs.get(job.id)).receipt;
    await engine.commit(await rt.jobs.get(job.id));
    expect((await rt.jobs.get(job.id)).receipt).toEqual(receipt);
    expect(analyze).toHaveBeenCalledTimes(1);
    commit.mockRestore();
  });
  it('isolates sessions and expires document content', async () => {
    const job = await make();
    await expect(rt.jobs.get(job.id, 'other')).rejects.toMatchObject({ status: 404 });
    await rt.pool.query(
      "UPDATE agent_demo.jobs SET expires_at=now()-interval '1 second' WHERE id=$1",
      [job.id],
    );
    await rt.jobs.cleanup();
    await expect(rt.jobs.get(job.id)).rejects.toMatchObject({ status: 410 });
    expect(
      (await rt.pool.query('SELECT document,result FROM agent_demo.jobs WHERE id=$1', [job.id]))
        .rows[0],
    ).toEqual({ document: null, result: null });
  });
  it('atomically claims the provider call even with concurrent execute attempts', async () => {
    const job = await make(),
      analyze = vi.fn(analyzeFixture),
      engine = new JobEngine(rt, analyze);
    await engine.quote(job.id);
    await engine.topup(job.id);
    await engine.prepare(job.id);
    await Promise.allSettled([engine.execute(job.id), engine.execute(job.id)]);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect((await rt.jobs.get(job.id)).phase).toBe('completed');
  });
  it('recovers when the ledger commit succeeds but saving the completed state fails', async () => {
    const job = await make(),
      analyze = vi.fn(analyzeFixture),
      engine = new JobEngine(rt, analyze);
    const original = rt.jobs.patch.bind(rt.jobs);
    let failOnce = true;
    const patch = vi.spyOn(rt.jobs, 'patch').mockImplementation(async (id, values) => {
      if (values.phase === 'completed' && failOnce) {
        failOnce = false;
        throw new Error('process lost after commit');
      }
      return original(id, values);
    });
    await engine.run(job.id);
    const saved = await rt.jobs.get(job.id);
    expect(saved.phase).toBe('result_saved');
    const before = await rt.ledger.getBalance(job.customer);
    await engine.commit(saved);
    expect((await rt.ledger.getBalance(job.customer)).availableUnits).toBe(before.availableUnits);
    expect((await rt.jobs.get(job.id)).phase).toBe('completed');
    expect(analyze).toHaveBeenCalledTimes(1);
    patch.mockRestore();
  });
  it('blocks unknown payments after restart and preserves jobs awaiting commit', async () => {
    const job = await make(),
      engine = new JobEngine(rt);
    await engine.quote(job.id);
    await engine.prepare(job.id);
    await rt.jobs.patch(job.id, { phase: 'payment_pending' });
    const saved = await make();
    await rt.jobs.patch(saved.id, { phase: 'result_saved' });
    await new JobStore(rt.pool).recoverInterrupted();
    expect((await rt.jobs.get(job.id)).phase).toBe('review_required');
    expect((await rt.jobs.get(saved.id)).phase).toBe('result_saved');
    await engine.run(job.id);
    expect(
      await rt.ledger.listFundingTransactions(
        (await rt.jobs.get(job.id)).challenge!.fundingIntent.id,
      ),
    ).toHaveLength(0);
  });
  it('allows only one concurrent reservation against a small shared customer balance', async () => {
    const owner = randomUUID();
    const [a, b] = await Promise.all([make(owner), make(owner)]);
    await rt.ledger.ensureAccount({ customerId: owner, idempotencyKey: `account:${owner}` });
    await rt.ledger.grantCredits({
      customerId: owner,
      amount: '0.01',
      idempotencyKey: `seed:${owner}`,
    });
    const engine = new JobEngine(rt);
    const results = await Promise.all([engine.prepare(a.id), engine.prepare(b.id)]);
    expect(results.map((x) => x.status).sort()).toEqual(['payment_required', 'reserved']);
  });
  it('guards the payment HTTP endpoint and credits a duplicate delivery only once', async () => {
    const job = await make(),
      engine = new JobEngine(rt);
    await engine.quote(job.id);
    await engine.prepare(job.id);
    await rt.jobs.patch(job.id, { phase: 'payment_pending' });
    const challenge = (await rt.jobs.get(job.id)).challenge!;
    const url = `http://127.0.0.1:3100/api/internal/topup/${job.id}`;
    const headers = { authorization: `Bearer ${paymentToken(job.id, rt.cfg.secret)}` };
    expect((await handle(new Request(url, { method: 'POST' }))).status).toBe(401);
    expect((await handle(new Request(url, { method: 'POST', headers }))).status).toBe(402);
    const auth = {
      from: rt.cfg.payer,
      to: rt.cfg.seller,
      value: challenge.fundingIntent.requestedUnits,
      validAfter: String(Math.floor(Date.now() / 1000) - 60),
      validBefore: String(Math.floor(Date.now() / 1000) + 604800),
      nonce: `0x${'ab'.repeat(32)}`,
    };
    const call = (authorization = auth) =>
      handle(
        new Request(url, {
          method: 'POST',
          headers: {
            ...headers,
            'payment-signature': Buffer.from(
              JSON.stringify({
                x402Version: 2,
                accepted: challenge.paymentRequired.accepts[0],
                payload: { signature: 'TEST_FIXTURE', authorization },
              }),
            ).toString('base64'),
          },
        }),
      );
    expect((await call({ ...auth, from: rt.cfg.seller })).status).toBe(400);
    expect((await call({ ...auth, value: '1' })).status).toBe(400);
    const [a, b] = await Promise.all([call(), call()]);
    expect([a.status, b.status]).toContain(200);
    expect([a.status, b.status].every((status) => status === 200 || status === 409)).toBe(true);
    expect((await call()).status).toBe(200);
    expect(await rt.ledger.listFundingTransactions(challenge.fundingIntent.id)).toHaveLength(1);
  });
  it('deduplicates workflow dispatch and claims the whole agent run once', async () => {
    const job = await make();
    const [first, second] = await Promise.all([
      rt.jobs.claimDispatch(job.id),
      rt.jobs.claimDispatch(job.id),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    await rt.jobs.recordDispatch(job.id, first ?? second!, 'opaque-workflow-run');
    expect(await rt.jobs.claimDispatch(job.id)).toBeNull();
    const engine = new JobEngine(rt, analyzeFixture);
    const run = vi.spyOn(engine, 'run');
    await Promise.all([
      executeWorkflowJob(rt, job.id, engine),
      executeWorkflowJob(rt, job.id, engine),
    ]);
    expect(run).toHaveBeenCalledTimes(1);
    expect((await rt.jobs.get(job.id)).phase).toBe('completed');
  });
  it('serializes the shared wallet across jobs without connection-scoped locks', async () => {
    const a = await make(),
      b = await make();
    const owner = randomUUID();
    expect(await rt.jobs.claimWorkflow(a.id, owner)).toBe('claimed');
    expect(await rt.jobs.claimWorkflow(b.id, randomUUID())).toBe('busy');
    await rt.jobs.finishWorkflow(a.id, randomUUID());
    expect(await rt.jobs.claimWorkflow(b.id, randomUUID())).toBe('busy');
    await rt.jobs.finishWorkflow(a.id, owner);
    expect(await rt.jobs.claimWorkflow(b.id, randomUUID())).toBe('claimed');
  });
  it('reconciles a terminated workflow without another agent or provider request', async () => {
    const job = await make(),
      owner = randomUUID();
    await rt.jobs.claimWorkflow(job.id, owner);
    await rt.jobs.patch(job.id, { phase: 'provider_pending' });
    await rt.jobs.reconcileWorkflows();
    expect((await rt.jobs.get(job.id)).phase).toBe('provider_pending');
    await rt.pool.query(
      "UPDATE agent_demo.executor SET started_at=now()-interval '11 minutes' WHERE id=1",
    );
    const engine = new JobEngine(rt),
      run = vi.spyOn(engine, 'run');
    expect(await recoverWorkflowJob(rt, job.id, engine)).toBe('review_required');
    await executeWorkflowJob(rt, job.id, engine);
    expect(run).not.toHaveBeenCalled();
    expect(await rt.jobs.claimWorkflow((await make()).id, randomUUID())).toBe('claimed');
  });
  it('retains wallet ownership when execution exits before saving a safe state', async () => {
    const job = await make(),
      queued = await make(),
      engine = new JobEngine(rt);
    vi.spyOn(engine, 'run').mockRejectedValueOnce(new Error('database write interrupted'));
    await expect(executeWorkflowJob(rt, job.id, engine)).rejects.toThrow(
      'database write interrupted',
    );
    expect(
      (
        await rt.pool.query<{ job_id: string | null }>(
          'SELECT job_id FROM agent_demo.executor WHERE id=1',
        )
      ).rows[0].job_id,
    ).toBe(job.id);
    expect(await rt.jobs.claimWorkflow(queued.id, randomUUID())).toBe('busy');
    await rt.pool.query(
      "UPDATE agent_demo.executor SET started_at=now()-interval '11 minutes' WHERE id=1",
    );
    expect(await recoverWorkflowJob(rt, job.id, engine)).toBe('review_required');
    expect(await rt.jobs.claimWorkflow(queued.id, randomUUID())).toBe('claimed');
  });
  it('releases wallet ownership after persisting an unknown provider outcome', async () => {
    const job = await make(),
      queued = await make(),
      analyze = vi.fn(async () => {
        throw new Error('provider response was lost');
      }),
      engine = new JobEngine(rt, analyze);
    expect(await executeWorkflowJob(rt, job.id, engine)).toBe('finished');
    expect((await rt.jobs.get(job.id)).phase).toBe('review_required');
    expect(await executeWorkflowJob(rt, job.id, engine)).toBe('finished');
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(await rt.jobs.claimWorkflow(queued.id, randomUUID())).toBe('claimed');
  });
  it('recovers a saved result through the workflow without another model call', async () => {
    const job = await make(),
      analyze = vi.fn(analyzeFixture),
      engine = new JobEngine(rt, analyze);
    vi.spyOn(rt.ledger, 'commitUsage').mockRejectedValueOnce(new Error('temporary commit failure'));
    await executeWorkflowJob(rt, job.id, engine);
    expect((await rt.jobs.get(job.id)).phase).toBe('result_saved');
    expect(await recoverWorkflowJob(rt, job.id, engine)).toBe('completed');
    expect(analyze).toHaveBeenCalledTimes(1);
  });
  it('keeps a failed dispatch recoverable after the enqueue acknowledgment is lost', async () => {
    const job = await make();
    expect(await rt.jobs.claimDispatch(job.id)).toBeTruthy();
    expect(await rt.jobs.pendingDispatches()).toHaveLength(0);
    await rt.pool.query(
      "UPDATE agent_demo.jobs SET dispatch_started_at=now()-interval '2 minutes' WHERE id=$1",
      [job.id],
    );
    expect(await rt.jobs.pendingDispatches()).toEqual([{ id: job.id }]);
    expect(await rt.jobs.claimDispatch(job.id)).toBeTruthy();
  });
});
