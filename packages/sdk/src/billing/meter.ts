/**
 * Usage metering for tracking API consumption and billing.
 *
 * @example
 * ```typescript
 * import { UsageMeter } from '@resvary/sdk/billing';
 *
 * const meter = new UsageMeter({ endpoint: '/api/data' });
 *
 * // Record usage
 * meter.record({ buyer: '0x...', amount: '0.001' });
 *
 * // Get usage summary
 * const summary = meter.getSummary('0x...');
 * console.log(summary.totalSpent); // '0.003'
 * ```
 */

/** Configuration for the usage meter */
export interface MeterConfig {
  /** Endpoint being metered */
  endpoint: string;
  /** Maximum records to keep in memory (default: 10000) */
  maxRecords?: number;
}

/** A single usage record */
export interface UsageRecord {
  /** Buyer's wallet address */
  buyer: `0x${string}`;
  /** Amount paid in USDC */
  amount: string;
  /** Endpoint accessed */
  endpoint: string;
  /** Timestamp of the request */
  timestamp: number;
  /** Settlement status */
  status: 'pending' | 'batched' | 'settled';
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/** Usage summary for a buyer */
export interface UsageSummary {
  /** Buyer's address */
  buyer: `0x${string}`;
  /** Total amount spent in USDC */
  totalSpent: string;
  /** Total number of requests */
  totalRequests: number;
  /** First usage timestamp */
  firstSeen: number;
  /** Last usage timestamp */
  lastSeen: number;
  /** Average cost per request */
  avgCostPerRequest: string;
}

/**
 * In-memory usage meter for tracking API consumption.
 *
 * For production use, extend with a persistent store
 * (Supabase, Postgres, Redis, etc.)
 */
/** @deprecated Use CreditLedger with meters, price versions, and usage receipts instead. */
export class UsageMeter {
  private readonly records: UsageRecord[] = [];
  private readonly endpoint: string;
  private readonly maxRecords: number;

  constructor(config: MeterConfig) {
    this.endpoint = config.endpoint;
    this.maxRecords = config.maxRecords ?? 10_000;
  }

  /**
   * Record a usage event.
   */
  record(params: { buyer: `0x${string}`; amount: string; metadata?: Record<string, unknown> }): UsageRecord {
    const record: UsageRecord = {
      buyer: params.buyer,
      amount: params.amount,
      endpoint: this.endpoint,
      timestamp: Date.now(),
      status: 'pending',
      metadata: params.metadata,
    };

    this.records.push(record);

    // Evict oldest records if over limit
    if (this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords);
    }

    return record;
  }

  /**
   * Get usage summary for a specific buyer.
   */
  getSummary(buyer: `0x${string}`): UsageSummary {
    const buyerRecords = this.records.filter(
      (r) => r.buyer.toLowerCase() === buyer.toLowerCase(),
    );

    if (buyerRecords.length === 0) {
      return {
        buyer,
        totalSpent: '0',
        totalRequests: 0,
        firstSeen: 0,
        lastSeen: 0,
        avgCostPerRequest: '0',
      };
    }

    const totalSpent = buyerRecords.reduce(
      (sum, r) => sum + parseFloat(r.amount),
      0,
    );

    return {
      buyer,
      totalSpent: totalSpent.toFixed(6),
      totalRequests: buyerRecords.length,
      firstSeen: buyerRecords[0]!.timestamp,
      lastSeen: buyerRecords[buyerRecords.length - 1]!.timestamp,
      avgCostPerRequest: (totalSpent / buyerRecords.length).toFixed(6),
    };
  }

  /**
   * Get all usage records, optionally filtered.
   */
  getRecords(filter?: {
    buyer?: `0x${string}`;
    since?: number;
    status?: UsageRecord['status'];
  }): UsageRecord[] {
    let filtered = [...this.records];

    if (filter?.buyer) {
      filtered = filtered.filter(
        (r) => r.buyer.toLowerCase() === filter.buyer!.toLowerCase(),
      );
    }

    if (filter?.since) {
      filtered = filtered.filter((r) => r.timestamp >= filter.since!);
    }

    if (filter?.status) {
      filtered = filtered.filter((r) => r.status === filter.status);
    }

    return filtered;
  }

  /**
   * Get aggregate stats across all buyers.
   */
  getAggregateStats(): {
    totalRevenue: string;
    totalRequests: number;
    uniqueBuyers: number;
    avgRevenuePerRequest: string;
  } {
    const totalRevenue = this.records.reduce(
      (sum, r) => sum + parseFloat(r.amount),
      0,
    );
    const uniqueBuyers = new Set(this.records.map((r) => r.buyer.toLowerCase())).size;

    return {
      totalRevenue: totalRevenue.toFixed(6),
      totalRequests: this.records.length,
      uniqueBuyers,
      avgRevenuePerRequest:
        this.records.length > 0
          ? (totalRevenue / this.records.length).toFixed(6)
          : '0',
    };
  }
}
