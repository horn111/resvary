import { createHash, randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import type { GatewayFundingRequest } from '@resvary/circle';
import type { UsageReceipt } from '@resvary/sdk/credits';
import { BUDGET_CEILING_UNITS, RUN_BUDGET_UNITS, estimate } from './config';
import type { AiConfig } from './ai-providers';
import { FREE_RUNS_PER_IP, PAID_ESTIMATED_USAGE, walletCustomer } from './billing';

export type Phase =
  | 'awaiting_credits'
  | 'queued'
  | 'running'
  | 'payment_pending'
  | 'funded'
  | 'reserved'
  | 'provider_pending'
  | 'result_saved'
  | 'completed'
  | 'failed'
  | 'review_required';
export interface Job {
  id: string;
  customer: string;
  billing_mode: 'free' | 'paid';
  billing_customer: string | null;
  request_key: string;
  input_hash: string;
  document: string | null;
  phase: Phase;
  created_at: Date;
  expires_at: Date;
  estimated: Record<string, string>;
  reservation_id: string | null;
  challenge: GatewayFundingRequest | null;
  result: string | null;
  usage: Record<string, string> | null;
  receipt: UsageReceipt | null;
  failure: string | null;
  model_cost: number;
  budget_settled: boolean;
  budget_charge_units: number | null;
  agent_usage: { inputTokens: number; outputTokens: number; requests: number } | null;
  ai_config: { agent: AiConfig; analysis: AiConfig } | null;
  workflow_run_id: string | null;
  dispatch_token: string | null;
  dispatch_started_at: Date | null;
  execution_token: string | null;
  execution_started_at: Date | null;
}
export class DemoError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const migration = `
CREATE SCHEMA IF NOT EXISTS agent_demo;
CREATE TABLE IF NOT EXISTS agent_demo.budget (
 id integer PRIMARY KEY CHECK(id=1), allocated bigint NOT NULL DEFAULT 0 CHECK(allocated>=0),
 ceiling bigint NOT NULL CHECK(ceiling BETWEEN 0 AND 10000000));
CREATE TABLE IF NOT EXISTS agent_demo.jobs (
 id uuid PRIMARY KEY, customer text NOT NULL, request_key uuid NOT NULL, input_hash text NOT NULL,
 document text, phase text NOT NULL, estimated jsonb NOT NULL, reservation_id text,
 challenge jsonb, result text, usage jsonb, receipt jsonb, failure text,
 model_cost integer NOT NULL DEFAULT 0,
 budget_settled boolean NOT NULL DEFAULT false,
 budget_charge_units integer,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
 UNIQUE(customer, request_key));
CREATE INDEX IF NOT EXISTS agent_jobs_queue ON agent_demo.jobs(created_at) WHERE phase='queued';
ALTER TABLE agent_demo.jobs ADD COLUMN IF NOT EXISTS agent_usage jsonb;
ALTER TABLE agent_demo.jobs ADD COLUMN IF NOT EXISTS budget_settled boolean NOT NULL DEFAULT false;
ALTER TABLE agent_demo.jobs ADD COLUMN IF NOT EXISTS budget_charge_units integer;
ALTER TABLE agent_demo.jobs ADD COLUMN IF NOT EXISTS ai_config jsonb;
ALTER TABLE agent_demo.jobs ADD COLUMN IF NOT EXISTS workflow_run_id text;
ALTER TABLE agent_demo.jobs ADD COLUMN IF NOT EXISTS dispatch_token uuid;
ALTER TABLE agent_demo.jobs ADD COLUMN IF NOT EXISTS dispatch_started_at timestamptz;
ALTER TABLE agent_demo.jobs ADD COLUMN IF NOT EXISTS execution_token uuid;
ALTER TABLE agent_demo.jobs ADD COLUMN IF NOT EXISTS execution_started_at timestamptz;
ALTER TABLE agent_demo.jobs ADD COLUMN IF NOT EXISTS billing_mode text NOT NULL DEFAULT 'free' CHECK(billing_mode IN ('free','paid'));
ALTER TABLE agent_demo.jobs ADD COLUMN IF NOT EXISTS billing_customer text;
CREATE TABLE IF NOT EXISTS agent_demo.authorizations (
 job_id uuid PRIMARY KEY REFERENCES agent_demo.jobs(id), hash text NOT NULL);
ALTER TABLE agent_demo.authorizations ADD COLUMN IF NOT EXISTS nonce text;
ALTER TABLE agent_demo.authorizations ADD COLUMN IF NOT EXISTS valid_before text;
CREATE TABLE IF NOT EXISTS agent_demo.quotas (
 key text PRIMARY KEY, used integer NOT NULL CHECK(used>=0));
CREATE TABLE IF NOT EXISTS agent_demo.free_trials (
 ip_hash text PRIMARY KEY, used integer NOT NULL CHECK(used BETWEEN 0 AND 3));
-- Retain historical sponsored usage across days; rerunning migrations never resets a quota.
INSERT INTO agent_demo.free_trials(ip_hash,used)
 SELECT split_part(key,':',3),LEAST(SUM(used),3)::integer FROM agent_demo.quotas
 WHERE key ~ '^ip:[0-9]{4}-[0-9]{2}-[0-9]{2}:[0-9a-f]{64}$'
 GROUP BY split_part(key,':',3) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS agent_demo.wallet_sessions (
 customer text PRIMARY KEY, address text NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS agent_demo.wallet_challenges (
 customer text PRIMARY KEY, address text NOT NULL, message text NOT NULL,
 expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS agent_demo.wallet_funding (
 id text PRIMARY KEY, customer text NOT NULL, request jsonb NOT NULL,
 tx_hash text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS agent_demo.events (
 seq bigserial PRIMARY KEY, job_id uuid NOT NULL REFERENCES agent_demo.jobs(id),
 kind text NOT NULL, detail jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS agent_demo.worker (
 id integer PRIMARY KEY CHECK(id=1), heartbeat timestamptz NOT NULL, ready boolean NOT NULL, message text NOT NULL);
CREATE TABLE IF NOT EXISTS agent_demo.executor (
 id integer PRIMARY KEY CHECK(id=1), job_id uuid, token uuid, started_at timestamptz);
INSERT INTO agent_demo.executor(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS agent_demo.maintenance (
 id integer PRIMARY KEY CHECK(id=1), last_started_at timestamptz,
 last_succeeded_at timestamptz, last_failed_at timestamptz,
 lease_token uuid, lease_expires_at timestamptz, cleaned_jobs integer NOT NULL DEFAULT 0);
INSERT INTO agent_demo.maintenance(id) VALUES(1) ON CONFLICT DO NOTHING;
`;

export class JobStore {
  constructor(public pool: Pool) {}
  async migrate(initialSpend = 0) {
    await this.pool.query(migration);
    await this.pool.query(
      'INSERT INTO agent_demo.budget(id,allocated,ceiling) VALUES(1,$1,$2) ON CONFLICT DO NOTHING',
      [initialSpend, BUDGET_CEILING_UNITS],
    );
  }
  async transaction<T>(callback: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const value = await callback(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async create(
    customer: string,
    key: string,
    document: string,
    ipHash: string,
    accepting: boolean,
    wallet?: string,
  ) {
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(key))
      throw new DemoError(400, 'A UUID request key is required');
    let estimated: Record<string, string>;
    try {
      estimated = estimate(document);
    } catch {
      throw new DemoError(400, 'Document must contain 1–12,288 UTF-8 bytes');
    }
    const hash = createHash('sha256').update(document).digest('hex');
    return this.transaction(async (client) => {
      // Global budget lock orders concurrent quota checks and duplicate submissions.
      const budget = (await client.query('SELECT * FROM agent_demo.budget WHERE id=1 FOR UPDATE'))
        .rows[0];
      const prior = (
        await client.query<Job>(
          'SELECT * FROM agent_demo.jobs WHERE customer=$1 AND request_key=$2',
          [customer, key],
        )
      ).rows[0];
      if (prior) {
        if (prior.input_hash !== hash)
          throw new DemoError(409, 'Request key belongs to a different document');
        if (prior.expires_at.getTime() <= Date.now())
          throw new DemoError(410, 'This document has expired');
        return prior;
      }
      if (!accepting)
        throw new DemoError(503, 'New runs are paused. Completed examples remain available.');
      if (!budget || Number(budget.allocated) + RUN_BUDGET_UNITS > Number(budget.ceiling))
        throw new DemoError(429, 'The demo AI budget is exhausted');
      const used = Number(
        (await client.query('SELECT used FROM agent_demo.free_trials WHERE ip_hash=$1', [ipHash]))
          .rows[0]?.used ?? 0,
      );
      const paid = used >= FREE_RUNS_PER_IP;
      if (paid && !wallet)
        throw new DemoError(
          402,
          'Your IP has used its three free runs. Connect a wallet and add credits to continue.',
        );
      // An unfunded paid job cannot enter the execution queue or consume the AI budget.
      if (paid) {
        const pending = await client.query(
          "SELECT id FROM agent_demo.jobs WHERE customer=$1 AND phase='awaiting_credits' AND expires_at>now() LIMIT 1",
          [customer],
        );
        if (pending.rowCount)
          throw new DemoError(409, 'Finish funding the pending request before creating another.');
      } else {
        await client.query(
          'INSERT INTO agent_demo.free_trials(ip_hash,used) VALUES($1,1) ON CONFLICT(ip_hash) DO UPDATE SET used=agent_demo.free_trials.used+1',
          [ipHash],
        );
        await client.query('UPDATE agent_demo.budget SET allocated=allocated+$1 WHERE id=1', [
          RUN_BUDGET_UNITS,
        ]);
      }
      return (
        await client.query<Job>(
          `INSERT INTO agent_demo.jobs(id,customer,request_key,input_hash,document,phase,estimated,billing_mode,billing_customer)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [
            randomUUID(),
            customer,
            key,
            hash,
            document,
            paid ? 'awaiting_credits' : 'queued',
            JSON.stringify(paid ? PAID_ESTIMATED_USAGE : estimated),
            paid ? 'paid' : 'free',
            paid ? walletCustomer(wallet!) : customer,
          ],
        )
      ).rows[0];
    });
  }
  async freeRunsRemaining(ipHash: string) {
    const result = await this.pool.query(
      'SELECT used FROM agent_demo.free_trials WHERE ip_hash=$1',
      [ipHash],
    );
    return Math.max(0, FREE_RUNS_PER_IP - Number(result.rows[0]?.used ?? 0));
  }
  async activatePaid(id: string, reservationId: string, accepting: boolean) {
    return this.transaction(async (client) => {
      const budget = (await client.query('SELECT * FROM agent_demo.budget WHERE id=1 FOR UPDATE'))
        .rows[0];
      const job = (
        await client.query<Job>('SELECT * FROM agent_demo.jobs WHERE id=$1 FOR UPDATE', [id])
      ).rows[0];
      if (!job || job.billing_mode !== 'paid') throw new DemoError(409, 'Invalid paid request');
      if (job.phase !== 'awaiting_credits') return job;
      if (!accepting || job.expires_at.getTime() <= Date.now())
        throw new DemoError(503, 'New runs are paused or this request has expired');
      if (!budget || Number(budget.allocated) + RUN_BUDGET_UNITS > Number(budget.ceiling))
        throw new DemoError(429, 'The demo AI budget is exhausted');
      await client.query('UPDATE agent_demo.budget SET allocated=allocated+$1 WHERE id=1', [
        RUN_BUDGET_UNITS,
      ]);
      return (
        await client.query<Job>(
          "UPDATE agent_demo.jobs SET reservation_id=$2,phase='queued' WHERE id=$1 RETURNING *",
          [id, reservationId],
        )
      ).rows[0];
    });
  }
  async get(id: string, customer?: string) {
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))
      throw new DemoError(404, 'Job not found');
    const job = (await this.pool.query<Job>('SELECT * FROM agent_demo.jobs WHERE id=$1', [id]))
      .rows[0];
    if (!job || (customer !== undefined && job.customer !== customer))
      throw new DemoError(404, 'Job not found');
    if (job.expires_at.getTime() <= Date.now())
      throw new DemoError(410, 'This document has expired');
    return job;
  }
  async list(customer: string) {
    return (
      await this.pool.query<{ id: string; phase: Phase }>(
        'SELECT id,phase FROM agent_demo.jobs WHERE customer=$1 AND expires_at>now() ORDER BY created_at DESC LIMIT 3',
        [customer],
      )
    ).rows;
  }
  async patch(
    id: string,
    values: Partial<
      Pick<
        Job,
        | 'phase'
        | 'reservation_id'
        | 'challenge'
        | 'result'
        | 'usage'
        | 'receipt'
        | 'failure'
        | 'model_cost'
        | 'agent_usage'
        | 'ai_config'
      >
    >,
  ) {
    const allowed = new Set([
      'phase',
      'reservation_id',
      'challenge',
      'result',
      'usage',
      'receipt',
      'failure',
      'model_cost',
      'agent_usage',
      'ai_config',
    ]);
    const entries = Object.entries(values);
    if (!entries.length || entries.some(([key]) => !allowed.has(key)))
      throw new Error('Invalid job update');
    await this.pool.query(
      `UPDATE agent_demo.jobs SET ${entries.map(([key], i) => `${key}=$${i + 2}`).join(',')} WHERE id=$1`,
      [id, ...entries.map(([, value]) => value)],
    );
  }
  async event(id: string, kind: string, detail: Record<string, unknown> = {}) {
    await this.pool.query('INSERT INTO agent_demo.events(job_id,kind,detail) VALUES($1,$2,$3)', [
      id,
      kind,
      JSON.stringify(detail),
    ]);
  }
  async settleBudget(id: string, actualUnits: number) {
    if (!Number.isSafeInteger(actualUnits) || actualUnits < 0 || actualUnits > RUN_BUDGET_UNITS) {
      throw new Error('Actual AI spend must fit inside the held run budget');
    }
    return this.transaction(async (client) => {
      const job = (
        await client.query<Pick<Job, 'phase' | 'budget_settled'>>(
          'SELECT phase,budget_settled FROM agent_demo.jobs WHERE id=$1 FOR UPDATE',
          [id],
        )
      ).rows[0];
      if (!job) throw new Error('Job not found');
      if (job.budget_settled) return false;
      if (job.phase !== 'completed')
        throw new Error('Only a completed job can settle its AI budget');
      const budget = (
        await client.query<{ allocated: string }>(
          'SELECT allocated::text FROM agent_demo.budget WHERE id=1 FOR UPDATE',
        )
      ).rows[0];
      if (!budget || Number(budget.allocated) < RUN_BUDGET_UNITS) {
        throw new Error('Held AI budget invariant failed');
      }
      await client.query('UPDATE agent_demo.budget SET allocated=allocated-$1+$2 WHERE id=1', [
        RUN_BUDGET_UNITS,
        actualUnits,
      ]);
      await client.query(
        'UPDATE agent_demo.jobs SET budget_settled=true,budget_charge_units=$2 WHERE id=$1',
        [id, actualUnits],
      );
      return true;
    });
  }
  async transition(id: string, from: Phase[], to: Phase) {
    return (
      (
        await this.pool.query(
          'UPDATE agent_demo.jobs SET phase=$3 WHERE id=$1 AND phase=ANY($2::text[]) RETURNING id',
          [id, from, to],
        )
      ).rowCount === 1
    );
  }
  async events(id: string) {
    return (
      await this.pool.query(
        'SELECT seq,kind,detail,created_at FROM agent_demo.events WHERE job_id=$1 ORDER BY seq LIMIT 100',
        [id],
      )
    ).rows;
  }
  async claim() {
    return this.transaction(async (client) => {
      const job = (
        await client.query<Job>(
          "SELECT * FROM agent_demo.jobs WHERE phase='queued' AND expires_at>now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
        )
      ).rows[0];
      if (!job) return null;
      await client.query("UPDATE agent_demo.jobs SET phase='running' WHERE id=$1", [job.id]);
      return { ...job, phase: 'running' as const };
    });
  }
  async claimDispatch(id: string) {
    const token = randomUUID();
    const claimed = await this.pool.query(
      `UPDATE agent_demo.jobs SET dispatch_token=$2,dispatch_started_at=now()
       WHERE id=$1 AND phase='queued' AND expires_at>now() AND workflow_run_id IS NULL
       AND (dispatch_started_at IS NULL OR dispatch_started_at<now()-interval '90 seconds')
       RETURNING id`,
      [id, token],
    );
    return claimed.rowCount === 1 ? token : null;
  }
  async recordDispatch(id: string, token: string, runId: string) {
    await this.pool.query(
      'UPDATE agent_demo.jobs SET workflow_run_id=$3 WHERE id=$1 AND dispatch_token=$2',
      [id, token, runId],
    );
  }
  async pendingDispatches() {
    return (
      await this.pool.query<{ id: string }>(
        `SELECT id FROM agent_demo.jobs WHERE phase='queued' AND expires_at>now()
         AND workflow_run_id IS NULL
         AND (dispatch_started_at IS NULL OR dispatch_started_at<now()-interval '90 seconds')
         ORDER BY created_at LIMIT 25`,
      )
    ).rows;
  }
  async claimWorkflow(id: string, token: string): Promise<'claimed' | 'busy' | 'finished'> {
    return this.transaction(async (client) => {
      // Persisted ownership works through transaction poolers and across serverless instances.
      // Never take over a live owner merely because another workflow was delivered.
      const executor = (
        await client.query('SELECT job_id FROM agent_demo.executor WHERE id=1 FOR UPDATE')
      ).rows[0];
      const job = (
        await client.query<Job>('SELECT * FROM agent_demo.jobs WHERE id=$1 FOR UPDATE', [id])
      ).rows[0];
      if (
        !job ||
        job.phase !== 'queued' ||
        job.execution_token ||
        job.expires_at.getTime() <= Date.now()
      )
        return 'finished';
      if (executor?.job_id) return 'busy';
      await client.query(
        'UPDATE agent_demo.executor SET job_id=$1,token=$2,started_at=now() WHERE id=1',
        [id, token],
      );
      await client.query(
        "UPDATE agent_demo.jobs SET phase='running',execution_token=$2,execution_started_at=now() WHERE id=$1",
        [id, token],
      );
      return 'claimed';
    });
  }
  async finishWorkflow(id: string, token: string) {
    await this.pool.query(
      'UPDATE agent_demo.executor SET job_id=NULL,token=NULL,started_at=NULL WHERE id=1 AND job_id=$1 AND token=$2',
      [id, token],
    );
  }
  async reconcileWorkflows() {
    return this.transaction(async (client) => {
      // 10 minutes exceeds the 300-second Vercel function limit plus the CLI's timeout.
      // A timed-out job is stopped for review; its execution token is never cleared.
      const stale = (
        await client.query<{ job_id: string }>(
          "SELECT job_id FROM agent_demo.executor WHERE id=1 AND job_id IS NOT NULL AND started_at<now()-interval '10 minutes' FOR UPDATE",
        )
      ).rows[0];
      if (!stale) return;
      await client.query(
        `UPDATE agent_demo.jobs SET phase='review_required',
         failure='Execution was interrupted. Reconcile payment and provider outcome before proceeding.'
         WHERE id=$1 AND phase NOT IN ('completed','failed','result_saved','review_required')`,
        [stale.job_id],
      );
      await client.query(
        'UPDATE agent_demo.executor SET job_id=NULL,token=NULL,started_at=NULL WHERE id=1',
      );
    });
  }
  async executionStatus(id: string) {
    const job = (
      await this.pool.query<{ phase: Phase; expires_at: Date; execution_started_at: Date | null }>(
        'SELECT phase,expires_at,execution_started_at FROM agent_demo.jobs WHERE id=$1',
        [id],
      )
    ).rows[0];
    return job ?? null;
  }
  async cachedReadiness() {
    return (
      (
        await this.pool.query<{ ready: boolean; message: string }>(
          "SELECT ready,message FROM agent_demo.worker WHERE id=1 AND heartbeat>now()-interval '60 seconds'",
        )
      ).rows[0] ?? null
    );
  }
  async readiness(ready: boolean, message: string) {
    await this.pool.query(
      'INSERT INTO agent_demo.worker VALUES(1,now(),$1,$2) ON CONFLICT(id) DO UPDATE SET heartbeat=now(),ready=$1,message=$2',
      [ready, message],
    );
  }
  async status() {
    const budget = (
      await this.pool.query('SELECT allocated,ceiling FROM agent_demo.budget WHERE id=1')
    ).rows[0];
    const worker = (
      await this.pool.query(
        "SELECT ready AND heartbeat>now()-interval '90 seconds' AS ready,message FROM agent_demo.worker WHERE id=1",
      )
    ).rows[0];
    return {
      remainingUnits: Number(budget?.ceiling ?? 0) - Number(budget?.allocated ?? 0),
      workerReady: worker?.ready === true,
      message: worker?.message ?? 'Worker is offline',
    };
  }
  async cleanup() {
    // Retain opaque ledger references and quota/budget accounting; erase submitted content.
    const result = await this.pool.query<{ count: number }>(
      `WITH cleared AS (
        UPDATE agent_demo.jobs SET document=NULL,result=NULL
        WHERE expires_at<=now() AND (document IS NOT NULL OR result IS NOT NULL)
        RETURNING id,expires_at
      ), recorded AS (
        INSERT INTO agent_demo.events(job_id,kind,detail)
        SELECT id,'content.expired',jsonb_build_object('expiresAt',expires_at,'clearedAt',now())
        FROM cleared RETURNING job_id
      ) SELECT count(*)::int AS count FROM recorded`,
    );
    return result.rows[0].count;
  }
  async recoverInterrupted() {
    await this.pool.query(
      "UPDATE agent_demo.jobs SET phase='review_required',failure='Worker restarted during execution; reconcile before retrying.' WHERE phase IN ('running','payment_pending','funded','reserved','provider_pending')",
    );
  }
}
