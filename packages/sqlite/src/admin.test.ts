import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { OperatorService } from '@resvary/sdk/admin';
import { CreditLedger } from '@resvary/sdk/credits';
import { createSqliteAdminStore } from './admin.js';
import { createSqliteCreditStore } from './credit.js';

function databasePath() {
  return join(mkdtempSync(join(tmpdir(), 'resvary-admin-')), 'admin.sqlite');
}

describe('SqliteAdminStore', () => {
  it('returns project-scoped overview, customers, audit evidence, and stable cursor pages', async () => {
    const path = databasePath();
    let now = Date.UTC(2026, 8, 4, 12);
    const store = createSqliteCreditStore({ path });
    const ledger = new CreditLedger({ projectId: 'project_primary', store, now: () => now });
    const meter = await ledger.registerMeter({
      key: 'tokens',
      dimensions: ['tokens'],
      idempotencyKey: 'meter',
    });
    const price = await ledger.createPriceVersion({
      meterKey: meter.key,
      rates: [{ dimension: 'tokens', unitSize: '1', amount: '0.01' }],
      idempotencyKey: 'price',
    });
    for (const [index, customerId] of [
      'customer_alpha',
      'customer_beta',
      'customer_gamma',
    ].entries()) {
      now += index + 1;
      await ledger.grantCredits({
        customerId,
        amount: '100',
        idempotencyKey: `grant-${customerId}`,
      });
    }
    const reservation = await ledger.reserveCredits({
      customerId: 'customer_alpha',
      priceId: price.id,
      estimatedUsage: { tokens: '500' },
      expiresAt: now + 60_000,
      idempotencyKey: 'reservation',
    });
    const committed = await ledger.commitUsage({
      reservationId: reservation.id,
      usageEventId: 'usage_alpha',
      actualUsage: { tokens: '400' },
      idempotencyKey: 'commit',
    });
    const otherProject = new CreditLedger({ projectId: 'project_other', store, now: () => now });
    await otherProject.grantCredits({
      customerId: 'customer_hidden',
      amount: '900',
      idempotencyKey: 'other-grant',
    });

    const admin = createSqliteAdminStore({ path });
    const overview = await admin.getOverview('project_primary', now);
    expect(overview).toMatchObject({
      projectId: 'project_primary',
      customerCount: 3,
      charged24hUnits: committed.receipt.amountUnits,
      charged30dUnits: committed.receipt.amountUnits,
    });
    expect(BigInt(overview.postedUnits)).toBeLessThan(BigInt('300000000'));

    const firstPage = await admin.listCustomers({ projectId: 'project_primary', limit: 2 });
    const secondPage = await admin.listCustomers({
      projectId: 'project_primary',
      limit: 2,
      cursor: firstPage.nextCursor,
    });
    expect(firstPage.items).toHaveLength(2);
    expect(secondPage.items).toHaveLength(1);
    expect(
      new Set([...firstPage.items, ...secondPage.items].map((item) => item.account.id)),
    ).toHaveProperty('size', 3);
    expect(
      (await admin.listCustomers({ projectId: 'project_primary', search: 'hidden' })).items,
    ).toHaveLength(0);

    const snapshot = await admin.listAuditItems({ projectId: 'project_primary', limit: 100 });
    const auditFirstPage = await admin.listAuditItems({ projectId: 'project_primary', limit: 2 });
    now += 1_000;
    await ledger.grantCredits({
      customerId: 'customer_beta',
      amount: '1',
      idempotencyKey: 'parallel-insert',
    });
    const pagedIds = auditFirstPage.items.map((item) => item.id);
    let cursor = auditFirstPage.nextCursor;
    while (cursor) {
      const next = await admin.listAuditItems({
        projectId: 'project_primary',
        limit: 2,
        cursor,
      });
      pagedIds.push(...next.items.map((item) => item.id));
      cursor = next.nextCursor;
    }
    expect(pagedIds).toEqual(snapshot.items.map((item) => item.id));
    expect(new Set(pagedIds).size).toBe(pagedIds.length);

    const audit = await admin.listAuditItems({
      projectId: 'project_primary',
      customerId: 'customer_alpha',
    });
    expect(audit.items.some((item) => item.kind === 'usage_receipt')).toBe(true);
    expect(audit.items.every((item) => item.projectId === 'project_primary')).toBe(true);
    const evidence = await admin.getUsageEvidence('project_primary', committed.receipt.id);
    expect(evidence).toMatchObject({
      receipt: { id: committed.receipt.id },
      reservation: { id: reservation.id },
      price: { id: price.id },
    });
    expect(evidence?.ledgerEntries.length).toBeGreaterThan(0);

    admin.close();
    store.close();
  });

  it('persists idempotent operator actions and restricts recovery operations', async () => {
    const path = databasePath();
    let now = 10_000;
    const store = createSqliteCreditStore({ path });
    const ledger = new CreditLedger({ projectId: 'project_ops', store, now: () => now });
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
    await ledger.grantCredits({
      customerId: 'customer_ops',
      amount: '10',
      idempotencyKey: 'seed-grant',
    });
    await ledger.reserveCredits({
      customerId: 'customer_ops',
      priceId: price.id,
      estimatedUsage: { jobs: '2' },
      expiresAt: now + 100,
      idempotencyKey: 'overdue-reservation',
    });
    const pending = await store.claimOutboxEvents({
      projectId: 'project_ops',
      workerId: 'test-worker',
      now,
      limit: 1,
      leaseMs: 1_000,
    });
    const deadLetter = pending[0];
    expect(deadLetter).toBeDefined();
    await store.failOutboxEvent({
      eventId: deadLetter!.id,
      workerId: 'test-worker',
      error: 'synthetic delivery failure',
      deadLetter: true,
      nextAttemptAt: now,
      attemptCount: deadLetter!.attemptCount,
    });

    const admin = createSqliteAdminStore({ path });
    const operator = new OperatorService({
      projectId: 'project_ops',
      ledger,
      adminStore: admin,
      deliveryStore: store,
      now: () => now,
    });
    const actionId = '8ba3e539-5f49-4e10-b371-40f33a6a9bb4';
    const first = await operator.grantCredits({
      actionId,
      customerId: 'customer_ops',
      amount: '3',
      reason: 'Restore credits after verified support incident',
    });
    const repeated = await operator.grantCredits({
      actionId,
      customerId: 'customer_ops',
      amount: '3',
      reason: 'Restore credits after verified support incident',
    });
    expect(repeated.action).toEqual(first.action);
    expect((await admin.listOperatorActions('project_ops')).items).toHaveLength(1);

    const recoveryActionId = 'eaa4bb85-8898-494f-a174-33691b036b67';
    let rejectSuccessJournalOnce = true;
    const recoveringAdmin = new Proxy(admin, {
      get(target, property) {
        if (property === 'appendOperatorAction') {
          return async (action: Parameters<typeof target.appendOperatorAction>[0]) => {
            if (
              action.id === recoveryActionId &&
              action.status === 'succeeded' &&
              rejectSuccessJournalOnce
            ) {
              rejectSuccessJournalOnce = false;
              throw new Error('synthetic journal outage');
            }
            return target.appendOperatorAction(action);
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const recoveringOperator = new OperatorService({
      projectId: 'project_ops',
      ledger,
      adminStore: recoveringAdmin,
      deliveryStore: store,
      now: () => now,
    });
    const recoveryInput = {
      actionId: recoveryActionId,
      customerId: 'customer_ops',
      amount: '2',
      reason: 'Verify recovery after the action journal becomes available',
    };
    await expect(recoveringOperator.grantCredits(recoveryInput)).rejects.toThrow(
      'synthetic journal outage',
    );
    expect((await admin.getOperatorAction('project_ops', recoveryActionId))?.status).toBe(
      'pending',
    );
    const recovered = await recoveringOperator.grantCredits(recoveryInput);
    expect(recovered.action.status).toBe('succeeded');
    expect((await ledger.getBalance('customer_ops')).postedUnits).toBe('15000000');

    now += 200;
    expect(() =>
      operator.expireOverdueReservations({
        actionId: '301450fc-5814-4d57-9e1a-6d559ed3f81e',
        reason: 'Future cutoffs must never release active reservations',
        before: now + 1,
      }),
    ).toThrow('cannot be in the future');
    const expired = await operator.expireOverdueReservations({
      actionId: '0908cd4f-bfea-466d-9f7d-9e5b9ca2f220',
      reason: 'Sweep reservations past their recorded expiry',
      before: now,
    });
    expect(expired.action.status).toBe('succeeded');
    expect(await admin.listOverdueReservations('project_ops', now)).toHaveLength(0);

    const requeued = await operator.requeueDeadLetter({
      actionId: '3fb0a343-0b69-4b3b-bbd9-ef8dd6a6359a',
      reason: 'Retry after downstream endpoint recovery',
      eventId: deadLetter!.id,
    });
    expect(requeued.action.status).toBe('succeeded');
    expect((await store.getOutboxEvent(deadLetter!.id))?.status).toBe('pending');

    await expect(
      operator.requeueDeadLetter({
        actionId: '8ded4888-70fb-4b85-8f9d-361362ea30ac',
        reason: 'This should be rejected because the event is no longer dead-lettered',
        eventId: deadLetter!.id,
      }),
    ).rejects.toThrow('is not dead-lettered');

    admin.close();
    store.close();
  });
});
