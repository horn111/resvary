import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { getOperationEvidence, OperatorService } from '@resvary/sdk/admin';
import {
  CreditLedger,
  DurableMeteredOperations,
  type MeteredOperation,
} from '@resvary/sdk/credits';
import { createSqliteCreditStore } from './credit.js';
import { createSqliteAdminStore } from './admin.js';

async function fixture() {
  const path = join(mkdtempSync(join(tmpdir(), 'resvary-recovery-')), 'ledger.sqlite');
  let now = 1_000;
  const store = createSqliteCreditStore({ path });
  const admin = createSqliteAdminStore({ path });
  const ledger = new CreditLedger({
    projectId: 'recovery',
    store,
    now: () => now,
    reservationTtlMs: 100,
  });
  await ledger.registerMeter({ key: 'jobs', dimensions: ['jobs'], idempotencyKey: 'meter' });
  const price = await ledger.createPriceVersion({
    meterKey: 'jobs',
    rates: [{ dimension: 'jobs', unitSize: '1', amount: '1' }],
    idempotencyKey: 'price',
  });
  await ledger.grantCredits({ customerId: 'customer', amount: '10', idempotencyKey: 'grant' });
  const operations = new DurableMeteredOperations(ledger, { now: () => now });
  const operator = new OperatorService({
    projectId: 'recovery',
    ledger,
    adminStore: admin,
    deliveryStore: store,
    now: () => now,
  });
  const create = (key: string) =>
    operations.create({
      customerId: 'customer',
      priceId: price.id,
      estimatedUsage: { jobs: '1' },
      idempotencyKey: key,
    });
  const save = async (key: string, jobs = '1') => {
    const claim = await operations.claim({ operationKey: key, workerId: 'private-worker-name' });
    return operations.saveResult({
      operationKey: key,
      claimToken: claim!.claimToken!,
      result: {
        value: 'private-provider-output',
        metadata: { secret: 'private-metadata' },
        actualUsage: { jobs },
        usageEventId: `usage-${key}`,
      },
    });
  };
  return {
    path,
    store,
    admin,
    ledger,
    price,
    operations,
    operator,
    create,
    save,
    setNow: (value: number) => {
      now = value;
    },
    close: () => {
      admin.close();
      store.close();
    },
  };
}

describe('durable operation administration', () => {
  it('settles a reviewed result once, preserves evidence, and redacts execution data everywhere', async () => {
    const f = await fixture();
    try {
      const created = await f.create('saved-job');
      const saved = await f.save('saved-job');
      const evidence = await getOperationEvidence(f.store, 'recovery', 'saved-job');
      expect(evidence).toMatchObject({
        amountUnits: '1000000',
        actualUsage: { jobs: '1' },
        usageEventId: 'usage-saved-job',
        operation: { hasSavedResult: true },
      });
      expect(await f.admin.getOperation('another-project', created.id)).toBeUndefined();
      expect(await getOperationEvidence(f.store, 'another-project', 'saved-job')).toBeUndefined();
      const command = {
        actionId: randomUUID(),
        operationKey: 'saved-job',
        resultHash: saved.resultHash!,
        reason: 'Reviewed immutable usage evidence',
      };
      await expect(
        f.operator.settleOperation({
          ...command,
          actionId: randomUUID(),
          resultHash: '0'.repeat(64),
        }),
      ).rejects.toThrow('does not match');
      const first = await f.operator.settleOperation(command);
      expect(first.result).toMatchObject({
        fromStatus: 'result_saved',
        resolved: true,
        operation: { status: 'settled' },
      });
      expect(await f.operator.settleOperation(command)).toEqual(first);
      await expect(
        f.operator.settleOperation({ ...command, reason: 'Changed reason' }),
      ).rejects.toThrow('another command');
      expect(await f.ledger.listUsageReceipts('customer')).toHaveLength(1);
      expect((await f.ledger.getBalance('customer')).postedAmount).toBe('9');
      const history = await f.admin.listOperationHistory('recovery', created.id, { limit: 2 });
      expect(history.items.map((item) => item.toStatus)).toEqual(['settled', 'result_saved']);
      expect(history.items.map((item) => item.sequence)).toEqual([4, 3]);
      const older = await f.admin.listOperationHistory('recovery', created.id, {
        limit: 2,
        cursor: history.nextCursor,
      });
      expect(older.items.map((item) => item.toStatus)).toEqual(['running', 'queued']);
      expect(older.nextCursor).toBeUndefined();
      expect(
        (await f.admin.listOperationHistory('another-project', created.id)).items,
      ).toHaveLength(0);
      const audit = await f.admin.listAuditItems({
        projectId: 'recovery',
        kind: 'metered_operation',
      });
      expect(audit.items).toHaveLength(1);
      const views = JSON.stringify([
        evidence,
        first,
        history,
        audit,
        await f.admin.listOperations({ projectId: 'recovery' }),
        await f.admin.listOperatorActions('recovery', {
          targetType: 'metered_operation',
          targetId: 'saved-job',
        }),
      ]);
      for (const secret of [
        'claimToken',
        'private-worker-name',
        'private-provider-output',
        'private-metadata',
        'savedResult',
      ])
        expect(views).not.toContain(secret);
      expect((await f.admin.getOperationHealth('recovery', 2_000)).unresolvedCount).toBe(0);
    } finally {
      f.close();
    }
  });

  it('requires external evidence for an unknown outcome and never reopens execution', async () => {
    const f = await fixture();
    try {
      await f.create('unknown-job');
      await f.operations.claim({ operationKey: 'unknown-job', workerId: 'worker' });
      const base = {
        operationKey: 'unknown-job',
        reason: 'Provider call outcome could not be established',
      };
      await f.operator.markOperationUnknown({ ...base, actionId: randomUUID() });
      expect(await f.admin.getOperationHealth('recovery', 5_000)).toMatchObject({
        unresolvedCount: 1,
        oldestUnresolvedAgeMs: 4_000,
        byStatus: { outcome_unknown: { count: 1, oldestAgeMs: 4_000 } },
      });
      await expect(
        f.operator.confirmOperationNotExecuted({
          ...base,
          actionId: randomUUID(),
          evidenceReference: ' ',
        }),
      ).rejects.toThrow('evidenceReference');
      expect(
        await f.operations.claim({ operationKey: 'unknown-job', workerId: 'second-worker' }),
      ).toBeUndefined();
      const command = {
        ...base,
        actionId: randomUUID(),
        evidenceReference: 'provider-log:request-404-confirmed-absent',
      };
      const result = await f.operator.confirmOperationNotExecuted(command);
      expect(result.result.operation.status).toBe('cancelled');
      expect(await f.operator.confirmOperationNotExecuted(command)).toEqual(result);
      expect(
        await f.operations.claim({ operationKey: 'unknown-job', workerId: 'third-worker' }),
      ).toBeUndefined();
      expect((await f.ledger.getBalance('customer')).availableAmount).toBe('10');
      expect(await f.ledger.listUsageReceipts('customer')).toHaveLength(0);
    } finally {
      f.close();
    }
  });

  it('recovers a lost command outcome after commit and reconciles expired holds without negative balance', async () => {
    const f = await fixture();
    try {
      await f.create('restart-job');
      const saved = await f.save('restart-job');
      const command = {
        actionId: randomUUID(),
        operationKey: 'restart-job',
        resultHash: saved.resultHash!,
        reason: 'Charge the saved result after worker restart',
      };
      const append = f.admin.appendOperatorAction.bind(f.admin);
      const failure = vi
        .spyOn(f.admin, 'appendOperatorAction')
        .mockImplementation(async (action) => {
          if (action.status === 'succeeded')
            throw new Error('simulated crash before journal outcome');
          return append(action);
        });
      await expect(f.operator.settleOperation(command)).rejects.toThrow('simulated crash');
      expect((await f.admin.getOperatorAction('recovery', command.actionId))?.status).toBe(
        'pending',
      );
      failure.mockRestore();
      const restarted = new OperatorService({
        projectId: 'recovery',
        ledger: f.ledger,
        adminStore: f.admin,
        deliveryStore: f.store,
      });
      expect((await restarted.settleOperation(command)).result.fromStatus).toBe('result_saved');
      expect(await f.ledger.listUsageReceipts('customer')).toHaveLength(1);

      await f.create('expired-job');
      const expired = await f.save('expired-job', '12');
      f.setNow(1_200);
      const settle = await f.operator.settleOperation({
        ...command,
        actionId: randomUUID(),
        operationKey: 'expired-job',
        resultHash: expired.resultHash!,
      });
      expect(settle.result).toMatchObject({
        resolved: false,
        operation: { status: 'needs_reconciliation' },
      });
      const reconcile = {
        ...command,
        actionId: randomUUID(),
        operationKey: 'expired-job',
        resultHash: expired.resultHash!,
      };
      await expect(f.operator.reconcileOperation(reconcile)).rejects.toThrow();
      expect((await f.operations.get('expired-job'))?.status).toBe('needs_reconciliation');
      expect((await f.ledger.getBalance('customer')).availableAmount).toBe('9');
      await f.ledger.grantCredits({
        customerId: 'customer',
        amount: '5',
        idempotencyKey: 'top-up',
      });
      // A failed command remains immutable. An intentional retry has a new UUID.
      await expect(f.operator.reconcileOperation(reconcile)).rejects.toThrow();
      const recovered = await f.operator.reconcileOperation({
        ...reconcile,
        actionId: randomUUID(),
      });
      expect(recovered.result.operation.status).toBe('settled');
      expect(recovered.result.operation.settlementReservationId).not.toBe(expired.reservationId);
      expect((await f.ledger.getBalance('customer')).postedAmount).toBe('2');
      expect(await f.ledger.listUsageReceipts('customer')).toHaveLength(2);
    } finally {
      f.close();
    }
  });

  it('pages beyond 500 operations with equal timestamps and applies tenant, age, status and literal search filters', async () => {
    const f = await fixture();
    try {
      const original = await f.create('template');
      // Isolated synthetic backlog: pagination must not depend on creating real provider jobs.
      await f.store.transaction(async (tx) => {
        for (let index = 0; index < 605; index++) {
          const id = `bulk_${String(index).padStart(4, '0')}`;
          await tx.saveMeteredOperation!({
            ...original,
            id,
            operationKey: id,
            requestHash: id,
            status: 'outcome_unknown',
            createdAt: 2_000,
            updatedAt: 3_000,
          });
        }
        await tx.saveMeteredOperation!({
          ...original,
          id: 'foreign',
          projectId: 'foreign',
          operationKey: 'hidden',
          requestHash: 'foreign',
        });
      });
      const ids: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await f.admin.listOperations({
          projectId: 'recovery',
          status: 'outcome_unknown',
          limit: 100,
          cursor,
        });
        ids.push(...page.items.map((item) => item.id));
        cursor = page.nextCursor;
      } while (cursor);
      expect(ids).toHaveLength(605);
      expect(new Set(ids).size).toBe(605);
      let after: { createdAt: number; id: string } | undefined;
      const sdkIds: string[] = [];
      for (;;) {
        const page: MeteredOperation[] = await f.operations.list({
          status: 'outcome_unknown',
          limit: 500,
          after,
        });
        if (!page.length) break;
        sdkIds.push(...page.map((item) => item.id));
        after = page.at(-1)!;
      }
      expect(new Set(sdkIds)).toEqual(new Set(ids));
      expect(
        (await f.admin.listOperations({ projectId: 'recovery', search: 'bulk_00' })).items,
      ).toHaveLength(50);
      expect(
        (await f.admin.listOperations({ projectId: 'recovery', search: '%' })).items,
      ).toHaveLength(0);
      expect(
        (await f.admin.listOperations({ projectId: 'recovery', search: 'hidden' })).items,
      ).toHaveLength(0);
      expect(
        (
          await f.admin.listOperations({
            projectId: 'recovery',
            status: 'outcome_unknown',
            updatedBefore: 2_999,
          })
        ).items,
      ).toHaveLength(0);
      await expect(
        f.admin.listOperations({ projectId: 'recovery', cursor: 'garbage' }),
      ).rejects.toThrow();
      expect(await f.admin.getOperationHealth('recovery', 8_000)).toMatchObject({
        unresolvedCount: 605,
        oldestUnresolvedAgeMs: 6_000,
      });
    } finally {
      f.close();
    }
  });
});
