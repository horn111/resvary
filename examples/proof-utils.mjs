import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { CreditLedger } from '@resvary/sdk/credits';
import { createSqliteCreditStore } from '@resvary/sqlite';

export function loadLocalEnv() {
  if (typeof process.loadEnvFile !== 'function') return;
  try {
    process.loadEnvFile('.env.local');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

export function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} in .env.local or the current shell`);
  return value;
}

export function requireAddress(name, fallbackName) {
  const value =
    process.env[name]?.trim() || (fallbackName ? requireEnv(fallbackName) : requireEnv(name));
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(
      `${name}${fallbackName ? ` or ${fallbackName}` : ''} must be a 20-byte EVM address`,
    );
  }
  return value;
}

export function requirePrivateKey(name, fallbackName) {
  const value =
    process.env[name]?.trim() || (fallbackName ? requireEnv(fallbackName) : requireEnv(name));
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(
      `${name}${fallbackName ? ` or ${fallbackName}` : ''} must be a 32-byte hex private key`,
    );
  }
  return value;
}

export function createProofId(prefix) {
  const explicit = process.env.RESVARY_PROOF_ID?.trim();
  if (explicit) {
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(explicit)) {
      throw new Error(
        'RESVARY_PROOF_ID must contain 8-80 letters, numbers, underscores, or dashes',
      );
    }
    return explicit;
  }
  return `${prefix}-${new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14)}`;
}

export async function runUsageLifecycle({ dbPath, projectId, customerId, proofId }) {
  const store = createSqliteCreditStore({ path: dbPath });
  const ledger = new CreditLedger({ projectId, store });
  try {
    const balanceBefore = await ledger.getBalance(customerId);
    const meter = await ledger.registerMeter({
      key: 'advanced_proof_units',
      name: 'Advanced proof usage units',
      dimensions: ['graduated_units', 'package_units'],
      idempotencyKey: 'proof-meter-v2',
    });
    const price = await ledger.createPriceVersion({
      meterKey: meter.key,
      components: [
        {
          model: 'graduated',
          dimension: 'graduated_units',
          tiers: [
            { upTo: '1', unitSize: '1', amount: '0.001' },
            { unitSize: '1', amount: '0.0005' },
          ],
        },
        {
          model: 'package',
          dimension: 'package_units',
          packageSize: '2',
          amount: '0.001',
        },
      ],
      idempotencyKey: 'proof-price-v2',
    });
    const result = await ledger.runMetered(
      {
        customerId,
        priceId: price.id,
        estimatedUsage: { graduated_units: '2', package_units: '3' },
        idempotencyKey: `proof-reserve:${proofId}`,
        metadata: { proofId },
      },
      async () => ({
        value: { ok: true },
        actualUsage: { graduated_units: '1', package_units: '2' },
        usageEventId: `proof-usage:${proofId}`,
        metadata: { proofId },
      }),
    );
    if (!result.receipt.allocations?.length) {
      throw new Error('Usage lifecycle did not record credit lot allocations');
    }
    if (result.balance.reservedUnits !== '0') {
      throw new Error('Usage lifecycle left reserved credits after commit');
    }
    const allocations = await Promise.all(
      result.receipt.allocations.map(async (allocation) => ({
        lotKind: (await ledger.getCreditLot(allocation.lotId))?.kind,
        allocatedAmount: allocation.allocatedAmount,
        consumedAmount: allocation.consumedAmount,
        releasedAmount: allocation.releasedAmount,
        expiredAmount: allocation.expiredAmount,
      })),
    );
    return {
      reservationId: result.reservation.id,
      usageReceiptId: result.receipt.id,
      priceVersionId: price.id,
      pricingModels: price.components?.map((component) => component.model),
      lineItems: result.receipt.lineItems,
      chargedAmount: result.receipt.amount,
      releasedAmount: result.receipt.releasedAmount,
      balanceBeforeUsage: balanceBefore.availableAmount,
      balanceAfterUsage: result.balance.availableAmount,
      reservedAfterCommit: result.balance.reservedAmount,
      allocations,
    };
  } finally {
    store.close();
  }
}

export async function writeEvidence(path, evidence) {
  const outputPath = resolve(path);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return outputPath;
}

export async function waitFor(predicate, { timeoutMs = 180_000, intervalMs = 2_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}
