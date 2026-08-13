import {
  creditUnitsToString,
  divideCeil,
  parseCreditUnits,
  toCreditUnits,
} from '../credits/amount.js';
import type {
  MeterDefinition,
  PriceRateInput,
  PriceVersion,
  RatedLineItem,
  RatedUsage,
  UsageQuantities,
} from '../credits/types.js';

export function createMeterDefinition(input: {
  id: string;
  projectId: string;
  key: string;
  name?: string;
  dimensions: string[];
  createdAt?: number;
  metadata?: Record<string, unknown>;
}): MeterDefinition {
  const dimensions = [...new Set(input.dimensions.map(assertIdentifier))];
  if (dimensions.length === 0) {
    throw new Error('A meter requires at least one dimension');
  }

  return {
    id: assertIdentifier(input.id),
    projectId: assertIdentifier(input.projectId),
    key: assertIdentifier(input.key),
    name: input.name?.trim() || input.key,
    dimensions,
    createdAt: input.createdAt ?? Date.now(),
    metadata: input.metadata,
  };
}

export function createPriceVersion(input: {
  id: string;
  projectId: string;
  meter: MeterDefinition;
  version: number;
  rates: PriceRateInput[];
  createdAt?: number;
  metadata?: Record<string, unknown>;
}): PriceVersion {
  if (!Number.isSafeInteger(input.version) || input.version < 1) {
    throw new Error('Price version must be a positive integer');
  }

  if (input.projectId !== input.meter.projectId) {
    throw new Error('Price and meter must belong to the same project');
  }

  if (input.rates.length === 0) {
    throw new Error('A price requires at least one rate');
  }

  const seen = new Set<string>();
  const rates = input.rates.map((rate) => {
    const dimension = assertIdentifier(rate.dimension);
    if (!input.meter.dimensions.includes(dimension)) {
      throw new Error(`Unknown meter dimension: ${dimension}`);
    }
    if (seen.has(dimension)) {
      throw new Error(`Duplicate price dimension: ${dimension}`);
    }
    seen.add(dimension);

    const unitSize = parsePositiveInteger(rate.unitSize, 'unitSize').toString();
    const amountUnits = toCreditUnits(rate.amount);
    if (amountUnits <= 0n) {
      throw new Error('Rate amount must be positive');
    }

    return {
      dimension,
      unitSize,
      amount: creditUnitsToString(amountUnits),
      amountUnits: amountUnits.toString(),
    };
  });

  return {
    id: assertIdentifier(input.id),
    projectId: assertIdentifier(input.projectId),
    meterId: input.meter.id,
    meterKey: input.meter.key,
    version: input.version,
    currency: 'USD',
    rates,
    createdAt: input.createdAt ?? Date.now(),
    metadata: input.metadata,
  };
}

export function rateUsage(price: PriceVersion, quantities: UsageQuantities): RatedUsage {
  const lineItems: RatedLineItem[] = price.rates.map((rate) => {
    const quantity = parseNonNegativeInteger(quantities[rate.dimension] ?? '0', rate.dimension);
    const rateUnits = parseCreditUnits(rate.amountUnits, 'rate amount units');
    const amountUnits = divideCeil(quantity * rateUnits, BigInt(rate.unitSize));

    return {
      dimension: rate.dimension,
      quantity: quantity.toString(),
      unitSize: rate.unitSize,
      rateAmount: rate.amount,
      rateUnits: rate.amountUnits,
      amount: creditUnitsToString(amountUnits),
      amountUnits: amountUnits.toString(),
    };
  });

  for (const dimension of Object.keys(quantities)) {
    if (!price.rates.some((rate) => rate.dimension === dimension)) {
      throw new Error(`Usage contains an unpriced dimension: ${dimension}`);
    }
  }

  const totalUnits = lineItems.reduce(
    (total, item) => total + parseCreditUnits(item.amountUnits),
    0n,
  );

  return {
    priceId: price.id,
    totalAmount: creditUnitsToString(totalUnits),
    totalUnits: totalUnits.toString(),
    lineItems,
  };
}

function assertIdentifier(value: string): string {
  const normalized = value.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(normalized)) {
    throw new Error(`Invalid identifier: ${value}`);
  }
  return normalized;
}

function parsePositiveInteger(value: string, label: string): bigint {
  const parsed = parseNonNegativeInteger(value, label);
  if (parsed === 0n) {
    throw new Error(`${label} must be positive`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string, label: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return BigInt(value);
}
