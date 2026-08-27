import { randomUUID } from 'node:crypto';
import type { CreditOutboxEvent, OutboxDeliveryStore } from '@resvary/sdk/credits';
import type { OutboxTransport, OutboxTransportResult } from './transport.js';

export interface OutboxWorkerLog {
  level: 'info' | 'warn' | 'error';
  message: string;
  workerId: string;
  eventId?: string;
  eventType?: string;
  attempt?: number;
  latencyMs?: number;
  error?: string;
}

export interface OutboxWorkerConfig {
  store: OutboxDeliveryStore;
  transport: OutboxTransport;
  workerId?: string;
  projectId?: string;
  batchSize?: number;
  leaseMs?: number;
  pollIntervalMs?: number;
  maxAttempts?: number;
  baseRetryMs?: number;
  maxRetryMs?: number;
  now?: () => number;
  random?: () => number;
  logger?: (entry: OutboxWorkerLog) => void;
}

export class OutboxWorker {
  readonly workerId: string;
  private readonly batchSize: number;
  private readonly leaseMs: number;
  private readonly pollIntervalMs: number;
  private readonly maxAttempts: number;
  private readonly baseRetryMs: number;
  private readonly maxRetryMs: number;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly logger: (entry: OutboxWorkerLog) => void;

  constructor(private readonly config: OutboxWorkerConfig) {
    this.workerId = config.workerId ?? `worker_${randomUUID()}`;
    this.batchSize = config.batchSize ?? 25;
    this.leaseMs = config.leaseMs ?? 30_000;
    this.pollIntervalMs = config.pollIntervalMs ?? 1_000;
    this.maxAttempts = config.maxAttempts ?? 8;
    this.baseRetryMs = config.baseRetryMs ?? 1_000;
    this.maxRetryMs = config.maxRetryMs ?? 300_000;
    this.now = config.now ?? Date.now;
    this.random = config.random ?? Math.random;
    this.logger = config.logger ?? (() => undefined);
    if (!this.workerId.trim()) throw new Error('workerId must not be empty');
    requirePositiveInteger(this.batchSize, 'batchSize');
    requirePositiveNumber(this.leaseMs, 'leaseMs');
    requirePositiveNumber(this.pollIntervalMs, 'pollIntervalMs');
    requirePositiveInteger(this.maxAttempts, 'maxAttempts');
    requirePositiveNumber(this.baseRetryMs, 'baseRetryMs');
    requirePositiveNumber(this.maxRetryMs, 'maxRetryMs');
    if (this.maxRetryMs < this.baseRetryMs) {
      throw new Error('maxRetryMs must be greater than or equal to baseRetryMs');
    }
  }

  async runOnce(signal: AbortSignal = new AbortController().signal): Promise<number> {
    if (signal.aborted) return 0;
    const events = await this.config.store.claimOutboxEvents({
      workerId: this.workerId,
      now: this.now(),
      leaseMs: this.leaseMs,
      limit: this.batchSize,
      projectId: this.config.projectId,
    });
    await Promise.all(events.map((event) => this.deliver(event, signal)));
    return events.length;
  }

  async run(signal: AbortSignal): Promise<void> {
    this.log({ level: 'info', message: 'outbox_worker_started' });
    while (!signal.aborted) {
      try {
        const count = await this.runOnce(signal);
        if (count === 0) await wait(this.pollIntervalMs, signal);
      } catch (error) {
        this.log({
          level: 'error',
          message: 'outbox_worker_iteration_failed',
          error: error instanceof Error ? error.message.slice(0, 1_024) : String(error),
        });
        await wait(this.pollIntervalMs, signal);
      }
    }
    this.log({ level: 'info', message: 'outbox_worker_stopped' });
  }

  private async deliver(event: CreditOutboxEvent, signal: AbortSignal): Promise<void> {
    const startedAt = this.now();
    let result: OutboxTransportResult;
    try {
      result = await this.config.transport.deliver(event, { signal });
    } catch (error) {
      result = {
        delivered: false,
        retryable: true,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    if (result.delivered) {
      await this.config.store.completeOutboxEvent(
        event.id,
        this.workerId,
        this.now(),
        event.attemptCount,
      );
      this.log({
        level: 'info',
        message: 'outbox_event_delivered',
        eventId: event.id,
        eventType: event.type,
        attempt: event.attemptCount,
        latencyMs: this.now() - startedAt,
      });
      return;
    }
    const deadLetter = !result.retryable || event.attemptCount >= this.maxAttempts;
    const retryAfterMs =
      result.retryAfterMs === undefined
        ? this.retryDelay(event.attemptCount)
        : Math.min(Math.max(0, result.retryAfterMs), this.maxRetryMs);
    const nextAttemptAt = this.now() + retryAfterMs;
    const error = (result.error ?? 'Webhook delivery failed').slice(0, 1_024);
    await this.config.store.failOutboxEvent({
      eventId: event.id,
      workerId: this.workerId,
      now: this.now(),
      error,
      nextAttemptAt,
      deadLetter,
      attemptCount: event.attemptCount,
    });
    this.log({
      level: deadLetter ? 'error' : 'warn',
      message: deadLetter ? 'outbox_event_dead_lettered' : 'outbox_event_retry_scheduled',
      eventId: event.id,
      eventType: event.type,
      attempt: event.attemptCount,
      latencyMs: this.now() - startedAt,
      error,
    });
  }

  private retryDelay(attempt: number): number {
    const base = Math.min(this.baseRetryMs * 2 ** Math.max(0, attempt - 1), this.maxRetryMs);
    return Math.round(base * (0.75 + this.random() * 0.5));
  }

  private log(entry: Omit<OutboxWorkerLog, 'workerId'>): void {
    this.logger({ ...entry, workerId: this.workerId });
  }
}

function requirePositiveNumber(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
}

function requirePositiveInteger(value: number, name: string): void {
  requirePositiveNumber(value, name);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`);
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    function done() {
      clearTimeout(timeout);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}
