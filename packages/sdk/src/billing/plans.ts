/**
 * Billing plan definitions for different pricing models.
 *
 * @example
 * ```typescript
 * import { createBillingPlan } from '@settlary/sdk/billing';
 *
 * const apiPlan = createBillingPlan({
 *   name: 'API Standard',
 *   pricing: { model: 'per-request', pricePerRequest: '0.001' },
 * });
 *
 * const cost = apiPlan.calculateCost({ requests: 100 });
 * console.log(cost); // '0.1'
 * ```
 */

/** Per-request pricing: fixed cost per API call */
export interface PerRequestPricing {
  model: 'per-request';
  /** Price in USDC per request */
  pricePerRequest: string;
}

/** Per-second pricing: time-based billing */
export interface PerSecondPricing {
  model: 'per-second';
  /** Price in USDC per second */
  pricePerSecond: string;
  /** Minimum billable seconds (default: 1) */
  minimumSeconds?: number;
}

/** Per-job pricing: batch operation billing */
export interface PerJobPricing {
  model: 'per-job';
  /** Base price in USDC per job */
  basePrice: string;
  /** Additional price per unit of work (e.g., per MB, per token) */
  pricePerUnit?: string;
  /** Name of the unit (e.g., 'MB', 'token', 'row') */
  unitName?: string;
}

/** Union of all pricing model types */
export type PricingModel = PerRequestPricing | PerSecondPricing | PerJobPricing;

/** Billing plan configuration */
export interface BillingPlan {
  /** Plan name */
  name: string;
  /** Plan description */
  description?: string;
  /** Pricing model */
  pricing: PricingModel;
  /** Calculate cost based on usage */
  calculateCost: (usage: UsageInput) => string;
  /** Get the minimum payment amount for this plan */
  getMinimumPayment: () => string;
}

/** Input for cost calculation */
export interface UsageInput {
  /** Number of requests (for per-request model) */
  requests?: number;
  /** Duration in seconds (for per-second model) */
  seconds?: number;
  /** Number of units processed (for per-job model) */
  units?: number;
}

/**
 * Create a billing plan with a specific pricing model.
 *
 * @param config - Plan configuration
 * @returns A billing plan with cost calculation methods
 */
export function createBillingPlan(config: {
  name: string;
  description?: string;
  pricing: PricingModel;
}): BillingPlan {
  const { name, description, pricing } = config;

  return {
    name,
    description,
    pricing,

    calculateCost(usage: UsageInput): string {
      switch (pricing.model) {
        case 'per-request': {
          const requests = usage.requests ?? 1;
          return (requests * parseFloat(pricing.pricePerRequest)).toFixed(6);
        }

        case 'per-second': {
          const seconds = Math.max(
            usage.seconds ?? 1,
            pricing.minimumSeconds ?? 1,
          );
          return (seconds * parseFloat(pricing.pricePerSecond)).toFixed(6);
        }

        case 'per-job': {
          const base = parseFloat(pricing.basePrice);
          const unitCost = pricing.pricePerUnit
            ? (usage.units ?? 0) * parseFloat(pricing.pricePerUnit)
            : 0;
          return (base + unitCost).toFixed(6);
        }

        default:
          throw new Error(`Unknown pricing model: ${(pricing as PricingModel).model}`);
      }
    },

    getMinimumPayment(): string {
      switch (pricing.model) {
        case 'per-request':
          return pricing.pricePerRequest;
        case 'per-second':
          return (
            parseFloat(pricing.pricePerSecond) * (pricing.minimumSeconds ?? 1)
          ).toFixed(6);
        case 'per-job':
          return pricing.basePrice;
        default:
          return '0.000001';
      }
    },
  };
}
