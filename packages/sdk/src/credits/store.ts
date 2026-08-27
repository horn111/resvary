import type {
  CreditAccount,
  CreditBalanceFilter,
  CreditGrant,
  CreditOutboxEvent,
  CreditReservation,
  FundingIntent,
  FundingTransaction,
  IdempotencyRecord,
  LedgerEntry,
  MeterDefinition,
  OutboxEventFilter,
  PriceVersion,
  UsageEvent,
  UsageReceipt,
} from './types.js';

export interface CreditReservationFilter extends CreditBalanceFilter {
  status?: CreditReservation['status'];
}

export interface CreditStoreReader {
  getAccount(id: string): Promise<CreditAccount | undefined>;
  getAccountByCustomer(projectId: string, customerId: string): Promise<CreditAccount | undefined>;
  listAccounts(filter?: CreditBalanceFilter): Promise<CreditAccount[]>;
  getGrant(id: string): Promise<CreditGrant | undefined>;
  listGrants(accountId?: string): Promise<CreditGrant[]>;
  getMeter(id: string): Promise<MeterDefinition | undefined>;
  getMeterByKey(projectId: string, key: string): Promise<MeterDefinition | undefined>;
  getPriceVersion(id: string): Promise<PriceVersion | undefined>;
  listPriceVersions(meterId?: string): Promise<PriceVersion[]>;
  getReservation(id: string): Promise<CreditReservation | undefined>;
  listReservations(filter?: CreditReservationFilter): Promise<CreditReservation[]>;
  getUsageEvent(id: string): Promise<UsageEvent | undefined>;
  getUsageReceipt(id: string): Promise<UsageReceipt | undefined>;
  listUsageReceipts(accountId?: string): Promise<UsageReceipt[]>;
  listLedgerEntries(accountId?: string): Promise<LedgerEntry[]>;
  getOutboxEvent(id: string): Promise<CreditOutboxEvent | undefined>;
  listOutboxEvents(filter?: OutboxEventFilter): Promise<CreditOutboxEvent[]>;
  getIdempotencyRecord(scope: string, key: string): Promise<IdempotencyRecord | undefined>;
  getFundingIntent(id: string): Promise<FundingIntent | undefined>;
  listFundingIntents(projectId?: string): Promise<FundingIntent[]>;
  getFundingTransaction(id: string): Promise<FundingTransaction | undefined>;
  getFundingTransactionByExternalPayment(
    rail: FundingTransaction['rail'],
    network: string,
    externalPaymentId: string,
  ): Promise<FundingTransaction | undefined>;
  getFundingTransactionByTxHash(
    network: string,
    txHash: `0x${string}`,
  ): Promise<FundingTransaction | undefined>;
  listFundingTransactions(fundingIntentId?: string): Promise<FundingTransaction[]>;
}

export interface CreditStoreTransaction extends CreditStoreReader {
  saveAccount(account: CreditAccount): Promise<void>;
  saveGrant(grant: CreditGrant): Promise<void>;
  saveMeter(meter: MeterDefinition): Promise<void>;
  savePriceVersion(price: PriceVersion): Promise<void>;
  saveReservation(reservation: CreditReservation): Promise<void>;
  saveUsageEvent(event: UsageEvent): Promise<void>;
  saveUsageReceipt(receipt: UsageReceipt): Promise<void>;
  saveLedgerEntry(entry: LedgerEntry): Promise<void>;
  saveOutboxEvent(event: CreditOutboxEvent): Promise<void>;
  saveIdempotencyRecord(record: IdempotencyRecord): Promise<void>;
  saveFundingIntent(intent: FundingIntent): Promise<void>;
  saveFundingTransaction(transaction: FundingTransaction): Promise<void>;
}

export interface CreditStore extends CreditStoreReader {
  transaction<T>(handler: (transaction: CreditStoreTransaction) => Promise<T>): Promise<T>;
}

export interface ClaimOutboxEventsInput {
  workerId: string;
  now: number;
  leaseMs: number;
  limit: number;
  projectId?: string;
}

export interface FailOutboxEventInput {
  eventId: string;
  workerId: string;
  now: number;
  error: string;
  nextAttemptAt: number;
  deadLetter: boolean;
  attemptCount?: number;
}

export interface OutboxDeliveryStore {
  claimOutboxEvents(input: ClaimOutboxEventsInput): Promise<CreditOutboxEvent[]>;
  completeOutboxEvent(
    eventId: string,
    workerId: string,
    deliveredAt: number,
    attemptCount?: number,
  ): Promise<void>;
  failOutboxEvent(input: FailOutboxEventInput): Promise<void>;
  listDeadLetterEvents(projectId?: string): Promise<CreditOutboxEvent[]>;
  requeueOutboxEvent(eventId: string, now: number): Promise<void>;
}

type MemoryState = {
  accounts: Map<string, CreditAccount>;
  grants: Map<string, CreditGrant>;
  meters: Map<string, MeterDefinition>;
  prices: Map<string, PriceVersion>;
  reservations: Map<string, CreditReservation>;
  usageEvents: Map<string, UsageEvent>;
  usageReceipts: Map<string, UsageReceipt>;
  ledgerEntries: Map<string, LedgerEntry>;
  outboxEvents: Map<string, CreditOutboxEvent>;
  idempotencyRecords: Map<string, IdempotencyRecord>;
  fundingIntents: Map<string, FundingIntent>;
  fundingTransactions: Map<string, FundingTransaction>;
};

export class InMemoryCreditStore implements CreditStore, OutboxDeliveryStore {
  private state = createMemoryState();
  private transactionTail: Promise<void> = Promise.resolve();

  async transaction<T>(handler: (transaction: CreditStoreTransaction) => Promise<T>): Promise<T> {
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.transactionTail;
    this.transactionTail = previous.then(() => current);
    await previous;

    const working = cloneMemoryState(this.state);
    try {
      const result = await handler(new MemoryCreditTransaction(working));
      this.state = working;
      return result;
    } finally {
      release();
    }
  }

  getAccount(id: string) {
    return reader(this.state).getAccount(id);
  }
  getAccountByCustomer(projectId: string, customerId: string) {
    return reader(this.state).getAccountByCustomer(projectId, customerId);
  }
  listAccounts(filter?: CreditBalanceFilter) {
    return reader(this.state).listAccounts(filter);
  }
  getGrant(id: string) {
    return reader(this.state).getGrant(id);
  }
  listGrants(accountId?: string) {
    return reader(this.state).listGrants(accountId);
  }
  getMeter(id: string) {
    return reader(this.state).getMeter(id);
  }
  getMeterByKey(projectId: string, key: string) {
    return reader(this.state).getMeterByKey(projectId, key);
  }
  getPriceVersion(id: string) {
    return reader(this.state).getPriceVersion(id);
  }
  listPriceVersions(meterId?: string) {
    return reader(this.state).listPriceVersions(meterId);
  }
  getReservation(id: string) {
    return reader(this.state).getReservation(id);
  }
  listReservations(filter?: CreditReservationFilter) {
    return reader(this.state).listReservations(filter);
  }
  getUsageEvent(id: string) {
    return reader(this.state).getUsageEvent(id);
  }
  getUsageReceipt(id: string) {
    return reader(this.state).getUsageReceipt(id);
  }
  listUsageReceipts(accountId?: string) {
    return reader(this.state).listUsageReceipts(accountId);
  }
  listLedgerEntries(accountId?: string) {
    return reader(this.state).listLedgerEntries(accountId);
  }
  getOutboxEvent(id: string) {
    return reader(this.state).getOutboxEvent(id);
  }
  listOutboxEvents(filter?: OutboxEventFilter) {
    return reader(this.state).listOutboxEvents(filter);
  }
  getIdempotencyRecord(scope: string, key: string) {
    return reader(this.state).getIdempotencyRecord(scope, key);
  }
  getFundingIntent(id: string) {
    return reader(this.state).getFundingIntent(id);
  }
  listFundingIntents(projectId?: string) {
    return reader(this.state).listFundingIntents(projectId);
  }
  getFundingTransaction(id: string) {
    return reader(this.state).getFundingTransaction(id);
  }
  getFundingTransactionByExternalPayment(
    rail: FundingTransaction['rail'],
    network: string,
    externalPaymentId: string,
  ) {
    return reader(this.state).getFundingTransactionByExternalPayment(
      rail,
      network,
      externalPaymentId,
    );
  }
  getFundingTransactionByTxHash(network: string, txHash: `0x${string}`) {
    return reader(this.state).getFundingTransactionByTxHash(network, txHash);
  }
  listFundingTransactions(fundingIntentId?: string) {
    return reader(this.state).listFundingTransactions(fundingIntentId);
  }

  claimOutboxEvents(input: ClaimOutboxEventsInput): Promise<CreditOutboxEvent[]> {
    return this.transaction(async (tx) => {
      const events = (await tx.listOutboxEvents({ projectId: input.projectId }))
        .filter(
          (event) =>
            (event.status === 'pending' && event.nextAttemptAt <= input.now) ||
            (event.status === 'processing' && (event.leaseExpiresAt ?? 0) <= input.now),
        )
        .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt || a.createdAt - b.createdAt)
        .slice(0, input.limit);
      const claimed: CreditOutboxEvent[] = [];
      for (const event of events) {
        const value: CreditOutboxEvent = {
          ...event,
          status: 'processing',
          attemptCount: event.attemptCount + 1,
          leaseOwner: input.workerId,
          leaseExpiresAt: input.now + input.leaseMs,
          lastAttemptAt: input.now,
        };
        await tx.saveOutboxEvent(value);
        claimed.push(value);
      }
      return claimed;
    });
  }

  async completeOutboxEvent(
    eventId: string,
    workerId: string,
    deliveredAt: number,
    attemptCount?: number,
  ): Promise<void> {
    await this.transaction(async (tx) => {
      const event = await requireClaimedEvent(tx, eventId, workerId, attemptCount);
      await tx.saveOutboxEvent({
        ...event,
        status: 'delivered',
        deliveredAt,
        nextAttemptAt: deliveredAt,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        lastError: undefined,
      });
    });
  }

  async failOutboxEvent(input: FailOutboxEventInput): Promise<void> {
    await this.transaction(async (tx) => {
      const event = await requireClaimedEvent(
        tx,
        input.eventId,
        input.workerId,
        input.attemptCount,
      );
      await tx.saveOutboxEvent({
        ...event,
        status: input.deadLetter ? 'dead_letter' : 'pending',
        nextAttemptAt: input.nextAttemptAt,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        lastError: input.error,
      });
    });
  }

  listDeadLetterEvents(projectId?: string): Promise<CreditOutboxEvent[]> {
    return this.listOutboxEvents({ projectId, status: 'dead_letter' });
  }

  async requeueOutboxEvent(eventId: string, now: number): Promise<void> {
    await this.transaction(async (tx) => {
      const event = await tx.getOutboxEvent(eventId);
      if (!event) throw new Error(`Outbox event not found: ${eventId}`);
      if (event.status !== 'dead_letter') {
        throw new Error(`Outbox event is not dead-lettered: ${eventId}`);
      }
      await tx.saveOutboxEvent({
        ...event,
        status: 'pending',
        attemptCount: 0,
        nextAttemptAt: now,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        lastError: undefined,
      });
    });
  }
}

async function requireClaimedEvent(
  tx: CreditStoreTransaction,
  eventId: string,
  workerId: string,
  attemptCount?: number,
): Promise<CreditOutboxEvent> {
  const event = await tx.getOutboxEvent(eventId);
  if (!event) throw new Error(`Outbox event not found: ${eventId}`);
  if (event.status !== 'processing' || event.leaseOwner !== workerId) {
    throw new Error(`Outbox event is not leased by worker ${workerId}: ${eventId}`);
  }
  if (attemptCount !== undefined && event.attemptCount !== attemptCount) {
    throw new Error(`Outbox lease attempt changed for event ${eventId}`);
  }
  return event;
}

class MemoryCreditTransaction implements CreditStoreTransaction {
  constructor(private readonly state: MemoryState) {}

  getAccount(id: string) {
    return reader(this.state).getAccount(id);
  }
  getAccountByCustomer(projectId: string, customerId: string) {
    return reader(this.state).getAccountByCustomer(projectId, customerId);
  }
  listAccounts(filter?: CreditBalanceFilter) {
    return reader(this.state).listAccounts(filter);
  }
  getGrant(id: string) {
    return reader(this.state).getGrant(id);
  }
  listGrants(accountId?: string) {
    return reader(this.state).listGrants(accountId);
  }
  getMeter(id: string) {
    return reader(this.state).getMeter(id);
  }
  getMeterByKey(projectId: string, key: string) {
    return reader(this.state).getMeterByKey(projectId, key);
  }
  getPriceVersion(id: string) {
    return reader(this.state).getPriceVersion(id);
  }
  listPriceVersions(meterId?: string) {
    return reader(this.state).listPriceVersions(meterId);
  }
  getReservation(id: string) {
    return reader(this.state).getReservation(id);
  }
  listReservations(filter?: CreditReservationFilter) {
    return reader(this.state).listReservations(filter);
  }
  getUsageEvent(id: string) {
    return reader(this.state).getUsageEvent(id);
  }
  getUsageReceipt(id: string) {
    return reader(this.state).getUsageReceipt(id);
  }
  listUsageReceipts(accountId?: string) {
    return reader(this.state).listUsageReceipts(accountId);
  }
  listLedgerEntries(accountId?: string) {
    return reader(this.state).listLedgerEntries(accountId);
  }
  getOutboxEvent(id: string) {
    return reader(this.state).getOutboxEvent(id);
  }
  listOutboxEvents(filter?: OutboxEventFilter) {
    return reader(this.state).listOutboxEvents(filter);
  }
  getIdempotencyRecord(scope: string, key: string) {
    return reader(this.state).getIdempotencyRecord(scope, key);
  }
  getFundingIntent(id: string) {
    return reader(this.state).getFundingIntent(id);
  }
  listFundingIntents(projectId?: string) {
    return reader(this.state).listFundingIntents(projectId);
  }
  getFundingTransaction(id: string) {
    return reader(this.state).getFundingTransaction(id);
  }
  getFundingTransactionByExternalPayment(
    rail: FundingTransaction['rail'],
    network: string,
    externalPaymentId: string,
  ) {
    return reader(this.state).getFundingTransactionByExternalPayment(
      rail,
      network,
      externalPaymentId,
    );
  }
  getFundingTransactionByTxHash(network: string, txHash: `0x${string}`) {
    return reader(this.state).getFundingTransactionByTxHash(network, txHash);
  }
  listFundingTransactions(fundingIntentId?: string) {
    return reader(this.state).listFundingTransactions(fundingIntentId);
  }

  async saveAccount(value: CreditAccount) {
    this.state.accounts.set(value.id, structuredClone(value));
  }
  async saveGrant(value: CreditGrant) {
    this.state.grants.set(value.id, structuredClone(value));
  }
  async saveMeter(value: MeterDefinition) {
    this.state.meters.set(value.id, structuredClone(value));
  }
  async savePriceVersion(value: PriceVersion) {
    this.state.prices.set(value.id, structuredClone(value));
  }
  async saveReservation(value: CreditReservation) {
    this.state.reservations.set(value.id, structuredClone(value));
  }
  async saveUsageEvent(value: UsageEvent) {
    this.state.usageEvents.set(value.id, structuredClone(value));
  }
  async saveUsageReceipt(value: UsageReceipt) {
    this.state.usageReceipts.set(value.id, structuredClone(value));
  }
  async saveLedgerEntry(value: LedgerEntry) {
    this.state.ledgerEntries.set(value.id, structuredClone(value));
  }
  async saveOutboxEvent(value: CreditOutboxEvent) {
    this.state.outboxEvents.set(value.id, structuredClone(value));
  }
  async saveIdempotencyRecord(value: IdempotencyRecord) {
    this.state.idempotencyRecords.set(
      idempotencyId(value.scope, value.key),
      structuredClone(value),
    );
  }
  async saveFundingIntent(value: FundingIntent) {
    this.state.fundingIntents.set(value.id, structuredClone(value));
  }
  async saveFundingTransaction(value: FundingTransaction) {
    this.state.fundingTransactions.set(value.id, structuredClone(value));
  }
}

function reader(state: MemoryState): CreditStoreReader {
  return {
    async getAccount(id) {
      return clone(state.accounts.get(id));
    },
    async getAccountByCustomer(projectId, customerId) {
      return clone(
        [...state.accounts.values()].find(
          (item) => item.projectId === projectId && item.customerId === customerId,
        ),
      );
    },
    async listAccounts(filter = {}) {
      return clones(
        [...state.accounts.values()].filter((item) => matchesBalanceFilter(item, filter)),
      );
    },
    async getGrant(id) {
      return clone(state.grants.get(id));
    },
    async listGrants(accountId) {
      return clones(
        [...state.grants.values()].filter((item) => !accountId || item.accountId === accountId),
      );
    },
    async getMeter(id) {
      return clone(state.meters.get(id));
    },
    async getMeterByKey(projectId, key) {
      return clone(
        [...state.meters.values()].find((item) => item.projectId === projectId && item.key === key),
      );
    },
    async getPriceVersion(id) {
      return clone(state.prices.get(id));
    },
    async listPriceVersions(meterId) {
      return clones(
        [...state.prices.values()].filter((item) => !meterId || item.meterId === meterId),
      );
    },
    async getReservation(id) {
      return clone(state.reservations.get(id));
    },
    async listReservations(filter = {}) {
      return clones(
        [...state.reservations.values()].filter(
          (item) =>
            matchesBalanceFilter(item, filter) && (!filter.status || item.status === filter.status),
        ),
      );
    },
    async getUsageEvent(id) {
      return clone(state.usageEvents.get(id));
    },
    async getUsageReceipt(id) {
      return clone(state.usageReceipts.get(id));
    },
    async listUsageReceipts(accountId) {
      return clones(
        [...state.usageReceipts.values()].filter(
          (item) => !accountId || item.accountId === accountId,
        ),
      );
    },
    async listLedgerEntries(accountId) {
      return clones(
        [...state.ledgerEntries.values()]
          .filter((item) => !accountId || item.accountId === accountId)
          .sort((a, b) => a.createdAt - b.createdAt),
      );
    },
    async getOutboxEvent(id) {
      return clone(state.outboxEvents.get(id));
    },
    async listOutboxEvents(filter = {}) {
      return clones(
        [...state.outboxEvents.values()]
          .filter(
            (item) =>
              (!filter.projectId || item.projectId === filter.projectId) &&
              (!filter.status || item.status === filter.status) &&
              (!filter.type || item.type === filter.type),
          )
          .sort((a, b) => a.createdAt - b.createdAt),
      );
    },
    async getIdempotencyRecord(scope, key) {
      return clone(state.idempotencyRecords.get(idempotencyId(scope, key)));
    },
    async getFundingIntent(id) {
      return clone(state.fundingIntents.get(id));
    },
    async listFundingIntents(projectId) {
      return clones(
        [...state.fundingIntents.values()].filter(
          (item) => !projectId || item.projectId === projectId,
        ),
      );
    },
    async getFundingTransaction(id) {
      return clone(state.fundingTransactions.get(id));
    },
    async getFundingTransactionByExternalPayment(rail, network, externalPaymentId) {
      const normalized = externalPaymentId.toLowerCase();
      return clone(
        [...state.fundingTransactions.values()].find(
          (item) =>
            item.rail === rail &&
            item.network === network &&
            item.externalPaymentId.toLowerCase() === normalized,
        ),
      );
    },
    async getFundingTransactionByTxHash(network, txHash) {
      return clone(
        [...state.fundingTransactions.values()].find(
          (item) => item.network === network && item.txHash?.toLowerCase() === txHash.toLowerCase(),
        ),
      );
    },
    async listFundingTransactions(fundingIntentId) {
      return clones(
        [...state.fundingTransactions.values()].filter(
          (item) => !fundingIntentId || item.fundingIntentId === fundingIntentId,
        ),
      );
    },
  };
}

function matchesBalanceFilter(
  value: { projectId: string; customerId: string },
  filter: CreditBalanceFilter,
): boolean {
  return (
    (!filter.projectId || value.projectId === filter.projectId) &&
    (!filter.customerId || value.customerId === filter.customerId)
  );
}

function createMemoryState(): MemoryState {
  return {
    accounts: new Map(),
    grants: new Map(),
    meters: new Map(),
    prices: new Map(),
    reservations: new Map(),
    usageEvents: new Map(),
    usageReceipts: new Map(),
    ledgerEntries: new Map(),
    outboxEvents: new Map(),
    idempotencyRecords: new Map(),
    fundingIntents: new Map(),
    fundingTransactions: new Map(),
  };
}

function cloneMemoryState(state: MemoryState): MemoryState {
  return {
    accounts: new Map(clones([...state.accounts.entries()])),
    grants: new Map(clones([...state.grants.entries()])),
    meters: new Map(clones([...state.meters.entries()])),
    prices: new Map(clones([...state.prices.entries()])),
    reservations: new Map(clones([...state.reservations.entries()])),
    usageEvents: new Map(clones([...state.usageEvents.entries()])),
    usageReceipts: new Map(clones([...state.usageReceipts.entries()])),
    ledgerEntries: new Map(clones([...state.ledgerEntries.entries()])),
    outboxEvents: new Map(clones([...state.outboxEvents.entries()])),
    idempotencyRecords: new Map(clones([...state.idempotencyRecords.entries()])),
    fundingIntents: new Map(clones([...state.fundingIntents.entries()])),
    fundingTransactions: new Map(clones([...state.fundingTransactions.entries()])),
  };
}

function idempotencyId(scope: string, key: string): string {
  return `${scope}\u0000${key}`;
}
function clone<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : structuredClone(value);
}
function clones<T>(values: T[]): T[] {
  return structuredClone(values);
}
