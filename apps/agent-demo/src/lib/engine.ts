import { Agent, Runner, tool } from '@openai/agents';
import { z } from 'zod';
import { createGatewayCreditGate } from '@resvary/circle';
import { funding } from './payments';
import { pay } from './circle-cli';
import { price, type Runtime } from './runtime';
import { MAX_OUTPUT_TOKENS, ANALYSIS_INSTRUCTIONS, RUN_BUDGET_UNITS } from './config';
import {
  analyzeWithProvider,
  createAgentModelProvider,
  resolveAiConfig,
  validateAiConfig,
  conservativeRunBudgetUnits,
  costUnits,
  ProviderRejected,
  type AiConfig,
} from './ai-providers';
import type { Job } from './store';

export type Analysis = { text: string; usage: Record<string, string> };
export { ProviderRejected } from './ai-providers';
export type Analyze = (
  document: string,
  options?: { config?: AiConfig; signal?: AbortSignal },
) => Promise<Analysis>;

export const analyzeLive: Analyze = (document, options) =>
  analyzeWithProvider(document, {
    ...options,
    instructions: ANALYSIS_INSTRUCTIONS,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });

export const analyzeFixture: Analyze = async (document) => ({
  text: `Summary\nThis is a deterministic local test, not a live AI response.\n\nKey facts\nThe supplied document contains ${Buffer.byteLength(document)} UTF-8 bytes.\n\nOpen questions\nRun the live provider to obtain a document analysis.`,
  usage: {
    input_tokens: String(Math.ceil(Buffer.byteLength(document) / 3) + 100),
    output_tokens: '64',
  },
});

export class JobEngine {
  private runSignal?: AbortSignal;
  private deadline = Infinity;
  private agentFailed = false;
  constructor(
    private rt: Runtime,
    private analyze: Analyze = rt.cfg.testMode ? analyzeFixture : analyzeLive,
  ) {}
  async quote(id: string) {
    const job = await this.rt.jobs.get(id);
    await this.rt.ledger.ensureAccount({
      customerId: job.customer,
      idempotencyKey: `account:${job.customer}`,
    });
    const balance = await this.rt.ledger.getBalance(job.customer);
    const required =
      BigInt(job.estimated.input_tokens) * 2n + BigInt(job.estimated.output_tokens) * 8n;
    return {
      availableUnits: balance.availableUnits,
      requiredUnits: required.toString(),
      needsTopUp: BigInt(balance.availableUnits) < required,
    };
  }
  async prepare(id: string) {
    const job = await this.rt.jobs.get(id);
    if (job.reservation_id) return { status: 'reserved' };
    if (job.challenge && job.phase !== 'funded') return { status: 'payment_required' };
    const pricing = await price(this.rt.ledger);
    const gate = createGatewayCreditGate({ ledger: this.rt.ledger, funding: funding(this.rt, id) });
    const outcome = await gate({
      customerId: job.customer,
      priceId: pricing.id,
      estimatedUsage: job.estimated,
      expectedPayer: this.rt.cfg.payer,
      idempotencyKey: `reserve:${id}`,
      fundingIdempotencyKey: `topup:${id}`,
      expiresAt: job.expires_at.getTime(),
    });
    if (outcome.status === 'reserved') {
      await this.rt.jobs.patch(id, { reservation_id: outcome.reservation.id, phase: 'reserved' });
      await this.rt.jobs.event(id, 'credits_reserved', {
        amount: outcome.reservation.reservedAmount,
      });
    } else {
      if (job.challenge) throw new Error('A second top-up would require a new user request');
      await this.rt.jobs.patch(id, { challenge: outcome.request });
      await this.rt.jobs.event(id, 'topup_required', {
        amount: outcome.request.fundingIntent.requestedAmount,
        fundingIntentId: outcome.request.fundingIntent.id,
      });
    }
    return { status: outcome.status };
  }
  async topup(id: string) {
    let job = await this.rt.jobs.get(id);
    if (job.reservation_id || job.phase === 'completed') return { status: 'not_needed' };
    if (!job.challenge) await this.prepare(id);
    job = await this.rt.jobs.get(id);
    if (!job.challenge) return { status: 'not_needed' };
    const transactions = await this.rt.ledger.listFundingTransactions(
      job.challenge.fundingIntent.id,
    );
    if (transactions.length) {
      await this.rt.jobs.patch(id, { phase: 'funded' });
      return { status: 'funded' };
    }
    if (['payment_pending', 'review_required', 'failed', 'provider_pending'].includes(job.phase))
      throw new Error('Payment outcome is unknown; automatic repayment is disabled');
    if (!(await this.rt.jobs.transition(id, ['queued', 'running'], 'payment_pending')))
      throw new Error('Payment was already claimed or requires review');
    await this.rt.jobs.event(id, 'payment_started', { network: 'Arc Testnet' });
    await pay(this.rt, job);
    const paid = await this.rt.ledger.listFundingTransactions(job.challenge.fundingIntent.id);
    if (
      paid.length !== 1 ||
      paid[0].customerId !== job.customer ||
      paid[0].settlementStatus !== 'settled'
    )
      throw new Error('Payment needs reconciliation');
    await this.rt.jobs.patch(id, { phase: 'funded' });
    await this.rt.jobs.event(id, 'credits_funded', {
      amount: paid[0].amount,
      fundingTransactionId: paid[0].id,
      reference: paid[0].evidence?.facilitatorReference,
      testFixture: this.rt.cfg.testMode,
    });
    return { status: 'funded' };
  }
  async execute(id: string) {
    let job = await this.rt.jobs.get(id);
    if (job.phase === 'completed') return { status: 'completed', replayed: true };
    if (job.phase === 'result_saved') {
      await this.commit(job);
      return { status: 'completed' };
    }
    if (['provider_pending', 'review_required', 'failed'].includes(job.phase))
      throw new Error('This job cannot execute again');
    const prepared = await this.prepare(id);
    if (prepared.status !== 'reserved') return prepared;
    job = await this.rt.jobs.get(id);
    if (!job.document || !job.reservation_id) throw new Error('Incomplete job');
    if (!(await this.rt.jobs.transition(id, ['reserved'], 'provider_pending')))
      throw new Error('Analysis was already claimed or requires review');
    await this.rt.jobs.event(id, 'analysis_started');
    let analysis: Analysis;
    try {
      analysis = await this.analyze(job.document, {
        config: job.ai_config?.analysis,
        signal: this.runSignal,
      });
    } catch (error) {
      if (error instanceof ProviderRejected) {
        await this.rt.ledger.releaseReservation({
          reservationId: job.reservation_id,
          idempotencyKey: `reject:${id}`,
          reason: 'provider_rejected',
        });
        await this.rt.jobs.patch(id, { phase: 'failed', failure: error.message });
        await this.rt.jobs.event(id, 'reservation_released');
      }
      throw error;
    }
    // Durable provider output must precede the credit commit. Never store document text in ledger metadata.
    await this.rt.jobs.patch(id, {
      result: analysis.text,
      usage: analysis.usage,
      phase: 'result_saved',
      ...(job.ai_config
        ? {
            model_cost: costUnits(
              job.ai_config.analysis,
              Number(analysis.usage.input_tokens),
              Number(analysis.usage.output_tokens),
            ),
          }
        : {}),
    });
    await this.commit(await this.rt.jobs.get(id));
    return { status: 'completed' };
  }
  async commit(job: Job) {
    if (!job.reservation_id || !job.usage || !job.result)
      throw new Error('No saved provider result');
    for (const dimension of ['input_tokens', 'output_tokens']) {
      if (
        !/^\d+$/.test(job.usage[dimension]) ||
        BigInt(job.usage[dimension]) > BigInt(job.estimated[dimension])
      ) {
        await this.rt.jobs.patch(job.id, {
          phase: 'review_required',
          failure: 'Provider usage exceeded quote; operator review required',
        });
        throw new Error('Provider usage exceeded quote; operator review required');
      }
    }
    const charged = await this.rt.ledger.commitUsage({
      reservationId: job.reservation_id,
      usageEventId: `analysis:${job.id}`,
      actualUsage: job.usage,
      idempotencyKey: `commit:${job.id}`,
    });
    await this.rt.jobs.patch(job.id, {
      receipt: charged.receipt,
      phase: 'completed',
      failure: null,
    });
    await this.rt.jobs.event(job.id, 'usage_charged', {
      receiptId: charged.receipt.id,
      charged: charged.receipt.amount,
      released: charged.receipt.releasedAmount,
    });
  }
  async run(id: string) {
    this.deadline = Date.now() + 230_000;
    this.runSignal = AbortSignal.timeout(230_000);
    this.agentFailed = false;
    try {
      const existing = await this.rt.jobs.get(id);
      if (
        existing.phase === 'completed' ||
        existing.phase === 'failed' ||
        existing.phase === 'review_required'
      )
        return;
      if (existing.phase === 'result_saved') {
        await this.commit(existing);
        return;
      }
      if (this.rt.cfg.testMode) {
        await this.quote(id);
        const result = await this.prepare(id);
        if (result.status === 'payment_required') await this.topup(id);
        await this.execute(id);
      } else {
        const snapshot = existing.ai_config ?? {
          agent: resolveAiConfig('agent'),
          analysis: resolveAiConfig('analysis'),
        };
        validateAiConfig(snapshot.agent);
        validateAiConfig(snapshot.analysis);
        if (conservativeRunBudgetUnits(snapshot.agent, snapshot.analysis) > RUN_BUDGET_UNITS)
          throw new Error('Configured models exceed the held AI budget');
        if (!existing.ai_config) await this.rt.jobs.patch(id, { ai_config: snapshot });
        let chain: Promise<unknown> = Promise.resolve();
        let steps = 0;
        const guarded =
          <T>(action: () => Promise<T>, requiredTime = 5_000) =>
          () => {
            const next = chain.then(async () => {
              if (
                this.agentFailed ||
                this.runSignal?.aborted ||
                Date.now() + requiredTime > this.deadline
              )
                throw new Error('Run deadline reached or a prior operation requires review');
              if (++steps > 8) throw new Error('Agent tool limit reached');
              try {
                return await action();
              } catch (error) {
                this.agentFailed = true;
                throw error;
              }
            });
            chain = next.catch(() => {});
            return next;
          };
        const tools = [
          tool({
            name: 'check_balance_and_quote',
            description: 'Read the current balance and required reservation for this document.',
            parameters: z.object({}),
            execute: guarded(() => this.quote(id)),
          }),
          tool({
            name: 'top_up',
            description:
              'Buy missing product credits via Circle Agent Wallet on Arc Testnet. Server enforces amount, recipient and one funding intent per job.',
            parameters: z.object({}),
            execute: guarded(() => this.topup(id), 100_000),
          }),
          tool({
            name: 'analyze_document',
            description:
              'Reserve credits, execute the paid document analysis and save the result and receipt. Returns payment_required when a top-up is needed.',
            parameters: z.object({}),
            execute: guarded(() => this.execute(id), 75_000),
          }),
          tool({
            name: 'get_result',
            description:
              'Get the completion status; the visitor receives the saved result through the authenticated web app.',
            parameters: z.object({}),
            execute: guarded(async () => ({ status: (await this.rt.jobs.get(id)).phase })),
          }),
        ];
        const agent = new Agent({
          name: 'Resvary document buyer',
          model: snapshot.agent.model,
          instructions:
            'Fulfil one document analysis request. First check the balance and quote. If funds are insufficient, top up once. Then analyze the document. Check the result. Stop after completion or any uncertain payment/provider error. Never repeat a payment or an uncertain analysis. You cannot change amounts, addresses or document contents.',
          tools,
          modelSettings: {
            maxTokens: 512,
            parallelToolCalls: false,
            store: false,
            retry: { maxRetries: 0 },
          },
        });
        const runner = new Runner({
          tracingDisabled: true,
          modelProvider: createAgentModelProvider(snapshot.agent, { signal: this.runSignal }),
        });
        const result = await runner.run(
          agent,
          'Analyze the document attached to this job using the paid API.',
          { maxTurns: 8, signal: this.runSignal },
        );
        const usage = result.state.usage;
        await this.rt.jobs.patch(id, {
          agent_usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            requests: usage.requests,
          },
        });
      }
      const final = await this.rt.jobs.get(id);
      if (final.phase !== 'completed') throw new Error('Agent stopped before completing the job');
    } catch {
      const job = await this.rt.jobs.get(id);
      if (!['completed', 'failed', 'result_saved'].includes(job.phase)) {
        await this.rt.jobs.patch(id, {
          phase: 'review_required',
          failure: 'Run paused for operator review. No automatic repayment or provider retry.',
        });
        await this.rt.jobs.event(id, 'review_required');
      }
      // result_saved is recoverable without another paid model call.
    }
  }
}
