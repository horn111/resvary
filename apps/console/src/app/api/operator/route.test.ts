import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreditLedger } from '@resvary/sdk/credits';
import { OperatorService } from '@resvary/sdk/admin';
import { createSqliteCreditStore } from '@resvary/sqlite';
import { createSqliteAdminStore } from '@resvary/sqlite/admin';
import { POST } from './route';

const { getRuntime, requireApiSession } = vi.hoisted(() => ({
  getRuntime: vi.fn(),
  requireApiSession: vi.fn(),
}));
vi.mock('@/lib/runtime', () => ({ getRuntime }));
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/auth')>()),
  requireApiSession,
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('operator HTTP commands', () => {
  it('replays an expiry sweep after a lost response without moving its cutoff', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const path = join(mkdtempSync(join(tmpdir(), 'resvary-route-')), 'ledger.sqlite');
    const store = createSqliteCreditStore({ path });
    const admin = createSqliteAdminStore({ path });
    const ledger = new CreditLedger({ projectId: 'route_test', store });
    const operator = new OperatorService({
      projectId: 'route_test',
      ledger,
      adminStore: admin,
      deliveryStore: store,
    });
    getRuntime.mockResolvedValue({ config: { demoMode: false }, operator });
    const body = {
      action: 'expire_overdue',
      actionId: randomUUID(),
      reason: 'Recover overdue test reservations',
    };
    const request = (payload = body) =>
      new Request('https://console.example/api/operator', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    try {
      await ledger.grantCredits({ customerId: 'customer', amount: '5', idempotencyKey: 'grant' });
      const meter = await ledger.registerMeter({
        key: 'jobs',
        dimensions: ['jobs'],
        idempotencyKey: 'meter',
      });
      const price = await ledger.createPriceVersion({
        meterKey: meter.key,
        rates: [{ dimension: 'jobs', unitSize: '1', amount: '1' }],
        idempotencyKey: 'price',
      });
      const reserve = (key: string, expiresAt: number) =>
        ledger.reserveCredits({
          customerId: 'customer',
          priceId: price.id,
          estimatedUsage: { jobs: '1' },
          expiresAt,
          idempotencyKey: key,
        });
      const overdue = await reserve('first', 1_100);
      const later = await reserve('later', 1_300);
      now = 1_200;
      // The command succeeds; its caller loses the response and retries the same JSON later.
      const original = await POST(request());
      expect(original.status).toBe(200);
      const firstResult = await original.json();
      now = 1_400;
      const replay = await POST(request());
      expect(replay.status).toBe(200);
      expect(await replay.json()).toEqual(firstResult);
      expect(await store.getReservation(overdue.id)).toMatchObject({ status: 'expired' });
      expect(await store.getReservation(later.id)).toMatchObject({ status: 'open' });
      expect(
        (await ledger.listLedgerEntries('customer')).filter((entry) => entry.type === 'release'),
      ).toHaveLength(1);
      const conflict = await POST(request({ ...body, reason: 'Changed command reason' }));
      expect(conflict.status).toBe(400);
      expect(await conflict.json()).toMatchObject({
        error: expect.stringContaining('another command'),
      });
    } finally {
      admin.close();
      store.close();
    }
  });
});
