#!/usr/bin/env node
import { createServer, type Server } from 'node:http';
import { checkPostgresHealth, createPostgresCreditStore } from '@resvary/postgres';
import { Pool } from 'pg';
import { createHttpWebhookTransport, OutboxWorker, type OutboxWorkerLog } from './index.js';

async function main(): Promise<void> {
  const [command = 'run', subcommand, eventId] = process.argv.slice(2);
  if (command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const connectionString = requireEnv('DATABASE_URL');
  const schema = process.env.RESVARY_POSTGRES_SCHEMA ?? 'public';
  const pool = new Pool({ connectionString });
  const store = createPostgresCreditStore({ pool, schema });
  try {
    if (command === 'dead-letter' && subcommand === 'list') {
      const events = await store.listDeadLetterEvents(process.env.RESVARY_PROJECT_ID);
      print(
        events.map((event) => ({
          id: event.id,
          projectId: event.projectId,
          type: event.type,
          attemptCount: event.attemptCount,
          lastError: event.lastError,
          createdAt: event.createdAt,
        })),
      );
      return;
    }
    if (command === 'dead-letter' && subcommand === 'requeue' && eventId) {
      await store.requeueOutboxEvent(eventId, Date.now());
      print({ ok: true, eventId, status: 'pending' });
      return;
    }
    if (command !== 'run') {
      throw new Error(usage());
    }

    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    const worker = new OutboxWorker({
      store,
      projectId: process.env.RESVARY_PROJECT_ID,
      workerId: process.env.RESVARY_WORKER_ID,
      batchSize: envPositiveInteger('RESVARY_WORKER_BATCH_SIZE', 25),
      leaseMs: envPositiveNumber('RESVARY_WORKER_LEASE_MS', 30_000),
      pollIntervalMs: envPositiveNumber('RESVARY_WORKER_POLL_MS', 1_000),
      maxAttempts: envPositiveInteger('RESVARY_WORKER_MAX_ATTEMPTS', 8),
      transport: createHttpWebhookTransport({
        url: requireEnv('RESVARY_WEBHOOK_URL'),
        secret: requireEnv('RESVARY_WEBHOOK_SECRET'),
        timeoutMs: envPositiveNumber('RESVARY_WEBHOOK_TIMEOUT_MS', 10_000),
      }),
      logger: jsonLogger,
    });
    const healthPort = envNumber('RESVARY_HEALTH_PORT', 0, 0);
    const healthServer =
      healthPort > 0
        ? await startHealthServer(healthPort, pool, schema, controller.signal)
        : undefined;
    try {
      await worker.run(controller.signal);
    } finally {
      await closeServer(healthServer);
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    }
  } finally {
    await store.close();
    await pool.end();
  }
}

function usage(): string {
  return 'Usage: resvary-worker [run|dead-letter list|dead-letter requeue EVENT_ID]';
}

async function startHealthServer(
  port: number,
  pool: Pool,
  schema: string,
  signal: AbortSignal,
): Promise<Server> {
  const server = createServer(async (request, response) => {
    if (request.url === '/live') {
      response.writeHead(signal.aborted ? 503 : 200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: !signal.aborted }));
      return;
    }
    if (request.url === '/ready') {
      const health = await checkPostgresHealth({ pool, schema });
      response.writeHead(health.ok ? 200 : 503, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify(
          health.ok
            ? health
            : { ...health, error: health.error ? 'postgres_not_ready' : undefined },
        ),
      );
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  return server;
}

function closeServer(server: Server | undefined): Promise<void> {
  if (!server) return Promise.resolve();
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function envNumber(name: string, fallback: number, minimum: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum)
    throw new Error(`${name} must be at least ${minimum}`);
  return value;
}

function envPositiveNumber(name: string, fallback: number): number {
  return envNumber(name, fallback, Number.MIN_VALUE);
}

function envPositiveInteger(name: string, fallback: number): number {
  const value = envPositiveNumber(name, fallback);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`);
  return value;
}

function jsonLogger(entry: OutboxWorkerLog): void {
  process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`);
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`,
  );
  process.exitCode = 1;
});
