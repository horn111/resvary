import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CreditLedger } from '../../../packages/sdk/dist/credits/index.js';
import { createSqliteCreditStore } from '../../../packages/sqlite/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const output = join(here, '..', 'fixtures', 'demo.sqlite');
mkdirSync(dirname(output), { recursive: true });
rmSync(output, { force: true });

let now = Date.UTC(2026, 7, 6, 14, 30);
const store = createSqliteCreditStore({ path: output });
const ledger = new CreditLedger({ projectId: 'project_demo', store, now: () => now });
const meter = await ledger.registerMeter({
  key: 'compute_seconds',
  name: 'Compute seconds',
  dimensions: ['seconds'],
  idempotencyKey: 'fixture-meter',
});
const price = await ledger.createPriceVersion({
  meterKey: meter.key,
  rates: [{ dimension: 'seconds', unitSize: '1', amount: '0.04' }],
  idempotencyKey: 'fixture-price',
});

for (let index = 1; index <= 72; index += 1) {
  const customerId = `cus_${String(index).padStart(4, '0')}`;
  now += 9 * 3_600_000 + index * 117;
  await ledger.grantCredits({
    customerId,
    amount: String(90 + (index % 11) * 17),
    source: index % 4 === 0 ? 'funding' : 'manual',
    idempotencyKey: `fixture-grant-${index}`,
  });
  if (index % 3 !== 0) {
    const estimated = String(25 + (index % 7) * 5);
    const reservation = await ledger.reserveCredits({
      customerId,
      priceId: price.id,
      estimatedUsage: { seconds: estimated },
      expiresAt: now + 3_600_000,
      idempotencyKey: `fixture-reserve-${index}`,
    });
    now += 8_000 + index * 43;
    await ledger.commitUsage({
      reservationId: reservation.id,
      usageEventId: `evt_fixture_${index}`,
      actualUsage: { seconds: String(Math.max(1, Number(estimated) - (index % 6))) },
      occurredAt: now - 3_000,
      idempotencyKey: `fixture-commit-${index}`,
    });
  }
}

const overdue = await ledger.reserveCredits({
  customerId: 'cus_0003',
  priceId: price.id,
  estimatedUsage: { seconds: '20' },
  expiresAt: now + 1_000,
  idempotencyKey: 'fixture-overdue',
});
now = overdue.expiresAt + 60_000;
const latestReservation = await ledger.reserveCredits({
  customerId: 'cus_0001',
  priceId: price.id,
  estimatedUsage: { seconds: '18' },
  expiresAt: now + 60_000,
  idempotencyKey: 'fixture-latest-reservation',
});
now += 1_000;
await ledger.commitUsage({
  reservationId: latestReservation.id,
  usageEventId: 'evt_fixture_latest',
  actualUsage: { seconds: '14' },
  occurredAt: now - 500,
  idempotencyKey: 'fixture-latest-commit',
});
const [claimed] = await store.claimOutboxEvents({
  projectId: 'project_demo',
  workerId: 'fixture-worker',
  now,
  limit: 1,
  leaseMs: 30_000,
});
if (claimed) {
  await store.failOutboxEvent({
    eventId: claimed.id,
    workerId: 'fixture-worker',
    attemptCount: claimed.attemptCount,
    error: 'Synthetic downstream delivery failure',
    deadLetter: true,
    nextAttemptAt: now,
  });
}
store.close();
console.log(output);
