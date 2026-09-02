import {
  creditUnitsToString,
  divideCeil,
  parseCreditUnits,
  toCreditUnits,
} from '../credits/amount.js';
import type {
  GraduatedPriceComponent,
  MeterDefinition,
  PackagePriceComponent,
  PriceComponent,
  PriceComponentInput,
  PriceRateInput,
  PriceVersion,
  RatedLineItem,
  RatedUsage,
  UsageQuantities,
} from '../credits/types.js';

interface PriceVersionDefinitionBase {
  id: string;
  projectId: string;
  meter: MeterDefinition;
  version: number;
  createdAt?: number;
  metadata?: Record<string, unknown>;
}

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

export function createPriceVersion(
  input: PriceVersionDefinitionBase & { rates: PriceRateInput[] },
): PriceVersion;
export function createPriceVersion(
  input: PriceVersionDefinitionBase & {
    components: PriceComponentInput[];
    rates?: PriceRateInput[];
  },
): PriceVersion;
export function createPriceVersion(
  input: PriceVersionDefinitionBase & {
    rates?: PriceRateInput[];
    components?: PriceComponentInput[];
  },
): PriceVersion {
  if (!Number.isSafeInteger(input.version) || input.version < 1) {
    throw new Error('Price version must be a positive integer');
  }

  if (input.projectId !== input.meter.projectId) {
    throw new Error('Price and meter must belong to the same project');
  }

  if (input.components && input.components.length === 0) {
    throw new Error('Advanced pricing requires at least one component');
  }
  if ((input.rates?.length ?? 0) === 0 && !input.components) {
    throw new Error('A price requires at least one rate or component');
  }

  const seen = new Set<string>();
  const claimDimension = (value: string) => {
    const dimension = assertIdentifier(value);
    if (!input.meter.dimensions.includes(dimension))
      throw new Error(`Unknown meter dimension: ${dimension}`);
    if (seen.has(dimension)) throw new Error(`Duplicate price dimension: ${dimension}`);
    seen.add(dimension);
    return dimension;
  };

  const rates = (input.rates ?? []).map((rate) => {
    const dimension = claimDimension(rate.dimension);

    const unitSize = parsePositiveInteger(rate.unitSize, 'unitSize').toString();
    const amountUnits = parsePositiveAmount(rate.amount, 'Rate amount');

    return {
      dimension,
      unitSize,
      amount: creditUnitsToString(amountUnits),
      amountUnits: amountUnits.toString(),
    };
  });
  const components = input.components?.map((component) =>
    normalizeComponent(component, claimDimension(component.dimension)),
  );

  return {
    id: assertIdentifier(input.id),
    projectId: assertIdentifier(input.projectId),
    meterId: input.meter.id,
    meterKey: input.meter.key,
    version: input.version,
    currency: 'USD',
    rates,
    ...(components ? { components } : {}),
    createdAt: input.createdAt ?? Date.now(),
    metadata: input.metadata,
  };
}

export function rateUsage(price: PriceVersion, quantities: UsageQuantities): RatedUsage {
  const knownDimensions = new Set([
    ...price.rates.map((rate) => rate.dimension),
    ...(price.components ?? []).map((component) => component.dimension),
  ]);
  for (const [dimension, quantity] of Object.entries(quantities)) {
    parseNonNegativeInteger(quantity, dimension);
    if (!knownDimensions.has(dimension)) {
      throw new Error(`Usage contains an unpriced dimension: ${dimension}`);
    }
  }

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
  for (const component of price.components ?? []) {
    const quantity = parseNonNegativeInteger(
      quantities[component.dimension] ?? '0',
      component.dimension,
    );
    lineItems.push(
      ...(component.model === 'graduated'
        ? rateGraduatedComponent(component, quantity)
        : [ratePackageComponent(component, quantity)]),
    );
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

function normalizeComponent(component: PriceComponentInput, dimension: string): PriceComponent {
  if (component.model === 'package') {
    const packageSize = parsePositiveInteger(component.packageSize, 'packageSize').toString();
    const amountUnits = parsePositiveAmount(component.amount, 'Package amount');
    return {
      model: 'package',
      dimension,
      packageSize,
      amount: creditUnitsToString(amountUnits),
      amountUnits: amountUnits.toString(),
    };
  }

  if (component.tiers.length === 0) {
    throw new Error('A graduated component requires at least one tier');
  }
  let previousUpTo = 0n;
  const tiers = component.tiers.map((tier, index) => {
    const finalTier = index === component.tiers.length - 1;
    if (finalTier && tier.upTo !== undefined) {
      throw new Error('The final graduated tier must be unbounded');
    }
    if (!finalTier && tier.upTo === undefined) {
      throw new Error('Only the final graduated tier may be unbounded');
    }
    let upTo: string | undefined;
    if (tier.upTo !== undefined) {
      const parsedUpTo = parsePositiveInteger(tier.upTo, 'tier upTo');
      if (parsedUpTo <= previousUpTo) {
        throw new Error('Graduated tier upTo values must be strictly increasing');
      }
      previousUpTo = parsedUpTo;
      upTo = parsedUpTo.toString();
    }
    const unitSize = parsePositiveInteger(tier.unitSize, 'tier unitSize').toString();
    const amountUnits = parsePositiveAmount(tier.amount, 'Tier amount');
    return {
      unitSize,
      amount: creditUnitsToString(amountUnits),
      amountUnits: amountUnits.toString(),
      ...(upTo ? { upTo } : {}),
    };
  });
  return { model: 'graduated', dimension, tiers };
}

function rateGraduatedComponent(
  component: GraduatedPriceComponent,
  quantity: bigint,
): RatedLineItem[] {
  let tierFrom = 0n;
  return component.tiers.map((tier, tierIndex) => {
    const tierUpTo = tier.upTo === undefined ? undefined : BigInt(tier.upTo);
    const capacity = tierUpTo === undefined ? undefined : tierUpTo - tierFrom;
    const remaining = quantity > tierFrom ? quantity - tierFrom : 0n;
    const tierQuantity = capacity === undefined || remaining < capacity ? remaining : capacity;
    const rateUnits = parseCreditUnits(tier.amountUnits, 'tier amount units');
    const amountUnits = divideCeil(tierQuantity * rateUnits, BigInt(tier.unitSize));
    const lineItem: RatedLineItem = {
      dimension: component.dimension,
      quantity: tierQuantity.toString(),
      unitSize: tier.unitSize,
      rateAmount: tier.amount,
      rateUnits: tier.amountUnits,
      amount: creditUnitsToString(amountUnits),
      amountUnits: amountUnits.toString(),
      pricingModel: 'graduated',
      tierIndex,
      tierFrom: tierFrom.toString(),
      ...(tier.upTo === undefined ? {} : { tierUpTo: tier.upTo }),
    };
    if (tierUpTo !== undefined) tierFrom = tierUpTo;
    return lineItem;
  });
}

function ratePackageComponent(component: PackagePriceComponent, quantity: bigint): RatedLineItem {
  const packageSize = BigInt(component.packageSize);
  const packageCount = quantity === 0n ? 0n : divideCeil(quantity, packageSize);
  const rateUnits = parseCreditUnits(component.amountUnits, 'package amount units');
  const amountUnits = packageCount * rateUnits;
  return {
    dimension: component.dimension,
    quantity: quantity.toString(),
    unitSize: component.packageSize,
    rateAmount: component.amount,
    rateUnits: component.amountUnits,
    amount: creditUnitsToString(amountUnits),
    amountUnits: amountUnits.toString(),
    pricingModel: 'package',
    packageSize: component.packageSize,
    packageCount: packageCount.toString(),
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

function parsePositiveAmount(value: string, label: string): bigint {
  const amountUnits = toCreditUnits(value);
  if (amountUnits <= 0n) throw new Error(`${label} must be positive`);
  return amountUnits;
}

function parseNonNegativeInteger(value: string, label: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return BigInt(value);
}
