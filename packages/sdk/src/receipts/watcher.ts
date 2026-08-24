/**
 * Arc Testnet receipt watcher for Memo-wrapped USDC invoice payments.
 */

import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  parseAbiItem,
  parseEventLogs,
  type Log,
  type PublicClient,
} from 'viem';
import { ARC_TESTNET, USDC_DECIMALS } from '../constants.js';
import { createMemoPaymentRequest, ERC20_TRANSFER_ABI } from './memo-payment.js';
import { createMemoPaymentProofFromReceipt } from './proof.js';
import { createWatcherCursorKey, type ReceiptStore } from './store.js';
import type {
  PaymentInvoice,
  PaymentReceipt,
  MemoPaymentRequest,
  ObservedPayment,
} from './types.js';

const MEMO_EVENT = parseAbiItem(
  'event Memo(address indexed sender,address indexed target,bytes32 callDataHash,bytes32 indexed memoId,bytes memo,uint256 memoIndex)',
);

export type ReceiptWatcherClient = Pick<
  PublicClient,
  'getBlockNumber' | 'getLogs' | 'getTransactionReceipt'
> &
  Partial<Pick<PublicClient, 'getChainId'>>;

type MemoLog = {
  transactionHash?: `0x${string}` | null;
  blockNumber?: bigint | null;
  args?: {
    sender?: `0x${string}`;
    target?: `0x${string}`;
    callDataHash?: `0x${string}`;
    memoId?: `0x${string}`;
    memo?: `0x${string}`;
    memoIndex?: bigint;
  };
};

type CompleteMemoArgs = {
  sender: `0x${string}`;
  target: `0x${string}`;
  callDataHash: `0x${string}`;
  memoId: `0x${string}`;
  memoIndex?: bigint;
};

type MatchedMemoLog = {
  txHash: `0x${string}`;
  blockNumber?: bigint;
  args: CompleteMemoArgs;
};

export type ReceiptWatcherLifecycleEvent =
  | { type: 'watcher.started'; invoiceCount: number }
  | { type: 'watcher.stopped' }
  | { type: 'watcher.poll'; fromBlock: bigint; toBlock: bigint; invoiceCount: number }
  | { type: 'watcher.memo_seen'; invoiceId: string; txHash: `0x${string}`; blockNumber?: bigint }
  | { type: 'watcher.receipt_created'; invoiceId: string; receipt: PaymentReceipt }
  | { type: 'watcher.cursor_saved'; invoiceId: string; cursorKey: string; nextFromBlock: bigint };

type MaybePromise<T> = T | Promise<T>;

export interface ReceiptLedgerWriter {
  recordPayment(invoiceId: string, payment: ObservedPayment): MaybePromise<PaymentReceipt>;
  getReceiptByTxHash(
    txHash: `0x${string}`,
    invoiceId?: string,
  ): MaybePromise<PaymentReceipt | undefined>;
}

export interface ReceiptWatcherConfig {
  ledger: ReceiptLedgerWriter;
  cursorStore?: ReceiptStore;
  rpcUrl?: string;
  publicClient?: ReceiptWatcherClient;
  fromBlock?: bigint;
  confirmations?: number;
  pollIntervalMs?: number;
  expectedChainId?: number;
  maxBlockRange?: number;
  cursorOverlap?: number;
  retryAttempts?: number;
  retryBaseDelayMs?: number;
  onReceipt?: (receipt: PaymentReceipt, invoice: PaymentInvoice) => void | Promise<void>;
  onEvent?: (event: ReceiptWatcherLifecycleEvent) => void | Promise<void>;
  onError?: (error: unknown) => void;
}

export class ReceiptWatcher {
  private readonly ledger: ReceiptLedgerWriter;
  private readonly cursorStore?: ReceiptStore;
  private readonly client: ReceiptWatcherClient;
  private readonly confirmations: bigint;
  private readonly pollIntervalMs: number;
  private readonly expectedChainId: number;
  private readonly maxBlockRange: bigint;
  private readonly cursorOverlap: bigint;
  private readonly retryAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly fromBlock?: bigint;
  private readonly onReceipt?: ReceiptWatcherConfig['onReceipt'];
  private readonly onEvent?: ReceiptWatcherConfig['onEvent'];
  private readonly onError?: ReceiptWatcherConfig['onError'];
  private readonly invoices = new Map<string, PaymentInvoice>();
  private readonly cursors = new Map<string, bigint>();
  private timer?: ReturnType<typeof setInterval>;

  constructor(config: ReceiptWatcherConfig) {
    this.ledger = config.ledger;
    this.cursorStore = config.cursorStore;
    this.client =
      config.publicClient ??
      createPublicClient({
        transport: http(config.rpcUrl ?? ARC_TESTNET.rpcUrl),
      });
    this.confirmations = BigInt(config.confirmations ?? 1);
    this.pollIntervalMs = config.pollIntervalMs ?? 5_000;
    this.expectedChainId = config.expectedChainId ?? ARC_TESTNET.chainId;
    this.maxBlockRange = BigInt(config.maxBlockRange ?? 2_000);
    this.cursorOverlap = BigInt(config.cursorOverlap ?? 0);
    this.retryAttempts = config.retryAttempts ?? 3;
    this.retryBaseDelayMs = config.retryBaseDelayMs ?? 250;
    this.fromBlock = config.fromBlock;
    if (this.maxBlockRange <= 0n) throw new Error('maxBlockRange must be positive');
    if (this.cursorOverlap < 0n) throw new Error('cursorOverlap cannot be negative');
    if (!Number.isSafeInteger(this.retryAttempts) || this.retryAttempts < 1) {
      throw new Error('retryAttempts must be a positive integer');
    }
    this.onReceipt = config.onReceipt;
    this.onEvent = config.onEvent;
    this.onError = config.onError;
  }

  watchInvoice(invoice: PaymentInvoice, options: { fromBlock?: bigint } = {}): void {
    this.invoices.set(invoice.id, invoice);
    if (options.fromBlock !== undefined) {
      this.cursors.set(invoice.id, options.fromBlock);
    }
  }

  unwatchInvoice(invoiceId: string): void {
    this.invoices.delete(invoiceId);
    this.cursors.delete(invoiceId);
  }

  async pollOnce(): Promise<PaymentReceipt[]> {
    if (this.invoices.size === 0) {
      return [];
    }

    if (this.client.getChainId) {
      const chainId = await this.withRetry(() => this.client.getChainId!());
      if (chainId !== this.expectedChainId) {
        throw new Error(
          `Receipt watcher chain mismatch: expected ${this.expectedChainId}, got ${chainId}`,
        );
      }
    }
    const latestBlock = await this.withRetry(() => this.client.getBlockNumber());
    const toBlock = latestBlock > this.confirmations ? latestBlock - this.confirmations : 0n;
    const receipts: PaymentReceipt[] = [];

    for (const invoice of this.invoices.values()) {
      const request = createMemoPaymentRequest(invoice);
      const fromBlock = await this.resolveFromBlock(invoice, request, toBlock);
      if (fromBlock > toBlock) {
        continue;
      }

      let chunkFrom = fromBlock;
      while (chunkFrom <= toBlock) {
        const chunkTo = minBigInt(toBlock, chunkFrom + this.maxBlockRange - 1n);
        await this.emit({
          type: 'watcher.poll',
          fromBlock: chunkFrom,
          toBlock: chunkTo,
          invoiceCount: this.invoices.size,
        });

        const invoiceReceipts = await this.pollInvoice(invoice, request, chunkFrom, chunkTo);
        receipts.push(...invoiceReceipts);
        await this.saveCursor(invoice, request, chunkTo + 1n);
        chunkFrom = chunkTo + 1n;
      }
    }

    return receipts;
  }

  start(): void {
    if (this.timer) {
      return;
    }

    void this.emit({ type: 'watcher.started', invoiceCount: this.invoices.size });
    void this.pollOnce().catch((error) => this.handleError(error));
    this.timer = setInterval(() => {
      void this.pollOnce().catch((error) => this.handleError(error));
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = undefined;
    void this.emit({ type: 'watcher.stopped' });
  }

  private async pollInvoice(
    invoice: PaymentInvoice,
    request: MemoPaymentRequest,
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<PaymentReceipt[]> {
    const memoLogs = (await this.withRetry(() =>
      this.client.getLogs({
        address: request.memoContract,
        event: MEMO_EVENT,
        args: { memoId: request.memoId },
        fromBlock,
        toBlock,
      }),
    )) as MemoLog[];

    const receipts: PaymentReceipt[] = [];

    for (const memoLog of memoLogs) {
      const receipt = await this.processMemoLog(invoice, request, memoLog);
      if (receipt) {
        receipts.push(receipt);
      }
    }

    return receipts;
  }

  private async processMemoLog(
    invoice: PaymentInvoice,
    request: MemoPaymentRequest,
    memoLog: MemoLog,
  ): Promise<PaymentReceipt | null> {
    const match = await this.getUnrecordedMatchingMemoLog(invoice.id, request, memoLog);
    if (!match) {
      return null;
    }

    await this.emit({
      type: 'watcher.memo_seen',
      invoiceId: invoice.id,
      txHash: match.txHash,
      blockNumber: match.blockNumber,
    });

    const txReceipt = await this.withRetry(() =>
      this.client.getTransactionReceipt({ hash: match.txHash }),
    );
    if (txReceipt.status !== 'success') {
      return null;
    }

    const transfer = extractMatchingTransfer(txReceipt.logs, request, match.args.sender);
    if (!transfer) {
      return null;
    }

    const onchainProof = createMemoPaymentProofFromReceipt({
      txHash: match.txHash,
      paymentRequest: request,
      txReceipt,
    });

    const observed: ObservedPayment = {
      txHash: match.txHash,
      from: transfer.from,
      to: transfer.to,
      amount: formatUnits(transfer.value, USDC_DECIMALS),
      currency: invoice.currency,
      network: invoice.network,
      memo: invoice.memo,
      memoId: request.memoId,
      callDataHash: request.callDataHash,
      blockNumber: txReceipt.blockNumber,
      onchainProof,
      observedAt: Date.now(),
      metadata: {
        source: 'arc-testnet-watcher',
        memoIndex: match.args.memoIndex?.toString(),
        explorerUrl: onchainProof.explorerUrl,
      },
    };

    const receipt = await this.ledger.recordPayment(invoice.id, observed);
    await this.onReceipt?.(receipt, invoice);
    await this.emit({ type: 'watcher.receipt_created', invoiceId: invoice.id, receipt });
    return receipt;
  }

  private async getUnrecordedMatchingMemoLog(
    invoiceId: string,
    request: MemoPaymentRequest,
    memoLog: MemoLog,
  ): Promise<MatchedMemoLog | null> {
    const match = getMatchingMemoLog(memoLog, request);
    if (!match) {
      return null;
    }

    if (await this.ledger.getReceiptByTxHash(match.txHash, invoiceId)) {
      return null;
    }

    return match;
  }

  private async resolveFromBlock(
    invoice: PaymentInvoice,
    request: MemoPaymentRequest,
    defaultFromBlock: bigint,
  ): Promise<bigint> {
    const memoryCursor = this.cursors.get(invoice.id);
    if (memoryCursor !== undefined) {
      return memoryCursor;
    }

    const cursorKey = this.getCursorKey(invoice, request);
    const persisted = await this.cursorStore?.getWatcherCursor(cursorKey);
    if (persisted) {
      this.cursors.set(invoice.id, persisted.nextFromBlock);
      return persisted.nextFromBlock;
    }

    return this.fromBlock ?? defaultFromBlock;
  }

  private async saveCursor(
    invoice: PaymentInvoice,
    request: MemoPaymentRequest,
    nextFromBlock: bigint,
  ): Promise<void> {
    const persistedFromBlock =
      nextFromBlock > this.cursorOverlap ? nextFromBlock - this.cursorOverlap : 0n;
    this.cursors.set(invoice.id, persistedFromBlock);

    if (!this.cursorStore) {
      return;
    }

    const cursorKey = this.getCursorKey(invoice, request);
    await this.cursorStore.saveWatcherCursor({
      key: cursorKey,
      invoiceId: invoice.id,
      memoId: request.memoId,
      network: invoice.network,
      nextFromBlock: persistedFromBlock,
      updatedAt: Date.now(),
    });
    await this.emit({
      type: 'watcher.cursor_saved',
      invoiceId: invoice.id,
      cursorKey,
      nextFromBlock: persistedFromBlock,
    });
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.retryAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt + 1 >= this.retryAttempts) break;
        const exponential = this.retryBaseDelayMs * 2 ** attempt;
        const jitter = Math.floor(Math.random() * Math.max(1, this.retryBaseDelayMs));
        await new Promise((resolve) => setTimeout(resolve, exponential + jitter));
      }
    }
    throw lastError;
  }

  private getCursorKey(invoice: PaymentInvoice, request: MemoPaymentRequest): string {
    return createWatcherCursorKey({
      network: invoice.network,
      invoiceId: invoice.id,
      memoId: request.memoId,
    });
  }

  private async emit(event: ReceiptWatcherLifecycleEvent): Promise<void> {
    await this.onEvent?.(event);
  }

  private handleError(error: unknown): void {
    if (this.onError) {
      this.onError(error);
      return;
    }

    throw error;
  }
}

function extractMatchingTransfer(
  logs: readonly Log[],
  request: MemoPaymentRequest,
  expectedFrom: `0x${string}`,
): { from: `0x${string}`; to: `0x${string}`; value: bigint } | null {
  const erc20Logs = logs.filter((log) => sameAddress(log.address, request.target));
  const parsedLogs = parseEventLogs({
    abi: ERC20_TRANSFER_ABI,
    eventName: 'Transfer',
    logs: erc20Logs,
    strict: false,
  });

  for (const parsedLog of parsedLogs) {
    const args = parsedLog.args as {
      from?: `0x${string}`;
      to?: `0x${string}`;
      value?: bigint;
    };

    if (!args.from || !args.to || args.value === undefined) {
      continue;
    }

    if (!sameAddress(args.from, expectedFrom)) {
      continue;
    }

    if (!sameAddress(args.to, request.payTo)) {
      continue;
    }

    if (args.value < BigInt(request.amountUnits)) {
      continue;
    }

    return {
      from: args.from,
      to: args.to,
      value: args.value,
    };
  }

  return null;
}

function getMatchingMemoLog(memoLog: MemoLog, request: MemoPaymentRequest): MatchedMemoLog | null {
  const txHash = memoLog.transactionHash;
  const args = memoLog.args;

  if (!txHash || !hasCompleteMemoArgs(args)) {
    return null;
  }

  if (!memoArgsMatchRequest(args, request)) {
    return null;
  }

  return {
    txHash,
    blockNumber: memoLog.blockNumber ?? undefined,
    args,
  };
}

function hasCompleteMemoArgs(args: MemoLog['args']): args is CompleteMemoArgs {
  return Boolean(args?.sender && args.target && args.callDataHash && args.memoId);
}

function memoArgsMatchRequest(args: CompleteMemoArgs, request: MemoPaymentRequest): boolean {
  return (
    sameAddress(args.target, request.target) &&
    args.memoId.toLowerCase() === request.memoId.toLowerCase() &&
    args.callDataHash.toLowerCase() === request.callDataHash.toLowerCase()
  );
}

function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function sameAddress(a: `0x${string}`, b: `0x${string}`): boolean {
  return getAddress(a) === getAddress(b);
}
