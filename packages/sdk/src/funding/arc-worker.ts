import type { CreditLedger, FundingIntent } from '../credits/index.js';
import {
  PersistentReceiptLedger,
  ReceiptWatcher,
  type PaymentReceipt,
  type ReceiptStore,
  type ReceiptWatcherClient,
  type ReceiptWatcherLifecycleEvent,
} from '../receipts/index.js';
import { ArcCreditFunding } from './arc.js';

export type ArcFundingWorkerEvent =
  | { type: 'arc_worker.resumed'; intentCount: number }
  | { type: 'arc_worker.reconciled'; fundingIntentId: string; txHash: `0x${string}` }
  | { type: 'arc_worker.invoice_missing'; fundingIntentId: string; invoiceId: string }
  | { type: 'arc_worker.watcher'; event: ReceiptWatcherLifecycleEvent };

export interface ArcFundingWorkerConfig {
  ledger: CreditLedger;
  receiptStore: ReceiptStore;
  payTo: `0x${string}`;
  rpcUrl?: string;
  publicClient?: ReceiptWatcherClient;
  fromBlock?: bigint;
  confirmations?: number;
  pollIntervalMs?: number;
  maxBlockRange?: number;
  cursorOverlap?: number;
  retryAttempts?: number;
  retryBaseDelayMs?: number;
  onEvent?: (event: ArcFundingWorkerEvent) => void | Promise<void>;
  onError?: (error: unknown) => void;
}

export class ArcFundingWorker {
  private readonly ledger: CreditLedger;
  private readonly receiptStore: ReceiptStore;
  private readonly funding: ArcCreditFunding;
  private readonly watcher: ReceiptWatcher;
  private readonly pollIntervalMs: number;
  private readonly onEvent?: ArcFundingWorkerConfig['onEvent'];
  private readonly onError?: ArcFundingWorkerConfig['onError'];
  private readonly watchedInvoices = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;
  private pollPromise?: Promise<PaymentReceipt[]>;

  constructor(config: ArcFundingWorkerConfig) {
    this.ledger = config.ledger;
    this.receiptStore = config.receiptStore;
    this.pollIntervalMs = config.pollIntervalMs ?? 5_000;
    this.onEvent = config.onEvent;
    this.onError = config.onError;
    this.funding = new ArcCreditFunding({
      ledger: config.ledger,
      payTo: config.payTo,
      receiptStore: config.receiptStore,
    });
    const receiptLedger = new PersistentReceiptLedger({ store: config.receiptStore });
    this.watcher = new ReceiptWatcher({
      ledger: receiptLedger,
      cursorStore: config.receiptStore,
      rpcUrl: config.rpcUrl,
      publicClient: config.publicClient,
      fromBlock: config.fromBlock,
      confirmations: config.confirmations ?? 1,
      maxBlockRange: config.maxBlockRange ?? 2_000,
      cursorOverlap: config.cursorOverlap ?? 2,
      retryAttempts: config.retryAttempts ?? 3,
      retryBaseDelayMs: config.retryBaseDelayMs ?? 250,
      onEvent: async (event) => this.emit({ type: 'arc_worker.watcher', event }),
      onReceipt: async (receipt) => this.confirmReceipt(receipt),
    });
  }

  async resumePendingIntents(): Promise<FundingIntent[]> {
    const intents = (await this.ledger.listFundingIntents()).filter(
      (intent) => intent.rail === 'arc_direct' && intent.status === 'pending',
    );
    for (const intent of intents) {
      if (this.watchedInvoices.has(intent.invoiceId)) continue;
      const invoice = await this.receiptStore.getInvoice(intent.invoiceId);
      if (!invoice) {
        await this.emit({
          type: 'arc_worker.invoice_missing',
          fundingIntentId: intent.id,
          invoiceId: intent.invoiceId,
        });
        continue;
      }
      this.watcher.watchInvoice(invoice);
      this.watchedInvoices.add(invoice.id);
    }
    await this.emit({ type: 'arc_worker.resumed', intentCount: intents.length });
    return intents;
  }

  async reconcile(): Promise<number> {
    const pending = (await this.ledger.listFundingIntents()).filter(
      (intent) => intent.rail === 'arc_direct' && intent.status === 'pending',
    );
    const receipts = await this.receiptStore.listReceipts();
    const receiptByInvoice = new Map(
      receipts.filter((receipt) => receipt.txHash).map((receipt) => [receipt.invoiceId, receipt]),
    );
    let reconciled = 0;
    for (const intent of pending) {
      const receipt = receiptByInvoice.get(intent.invoiceId);
      if (!receipt?.txHash) continue;
      await this.confirmReceipt(receipt);
      reconciled += 1;
    }
    return reconciled;
  }

  async pollOnce(): Promise<PaymentReceipt[]> {
    if (this.pollPromise) return this.pollPromise;
    this.pollPromise = (async () => {
      await this.resumePendingIntents();
      const receipts = await this.watcher.pollOnce();
      await this.reconcile();
      return receipts;
    })();
    try {
      return await this.pollPromise;
    } finally {
      this.pollPromise = undefined;
    }
  }

  start(): void {
    if (this.timer) return;
    void this.pollOnce().catch((error) => this.handleError(error));
    this.timer = setInterval(() => {
      void this.pollOnce().catch((error) => this.handleError(error));
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private async confirmReceipt(receipt: PaymentReceipt): Promise<void> {
    if (!receipt.txHash) return;
    const intent = (await this.ledger.listFundingIntents()).find(
      (item) => item.invoiceId === receipt.invoiceId,
    );
    if (!intent || intent.status !== 'pending') return;
    await this.funding.confirmPayment({
      fundingIntentId: intent.id,
      receipt,
      idempotencyKey: `arc-worker:${receipt.txHash.toLowerCase()}`,
      metadata: { source: 'arc-funding-worker' },
    });
    await this.emit({
      type: 'arc_worker.reconciled',
      fundingIntentId: intent.id,
      txHash: receipt.txHash,
    });
  }

  private async emit(event: ArcFundingWorkerEvent): Promise<void> {
    await this.onEvent?.(event);
  }

  private handleError(error: unknown): void {
    if (this.onError) this.onError(error);
    else console.error('[resvary:arc-worker]', error);
  }
}
