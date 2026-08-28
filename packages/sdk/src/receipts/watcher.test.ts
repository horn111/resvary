import { describe, expect, it, vi } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from 'viem';
import { ARC_TESTNET_CONTRACTS } from '../constants.js';
import { ReceiptLedger } from './ledger.js';
import { ARC_MEMO_ABI, createMemoPaymentRequest } from './memo-payment.js';
import { InMemoryReceiptStore, createWatcherCursorKey } from './store.js';
import { ReceiptWatcher } from './watcher.js';

const seller = '0x1111111111111111111111111111111111111111' as const;
const buyer = '0x2222222222222222222222222222222222222222' as const;
const txHash = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
const blockHash = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const;
const transferEvent = parseAbiItem(
  'event Transfer(address indexed from,address indexed to,uint256 value)',
);
const memoEvent = ARC_MEMO_ABI.find((item) => item.type === 'event' && item.name === 'Memo');

describe('ReceiptWatcher', () => {
  it('rejects cursor overlap that cannot make forward progress', () => {
    const ledger = new ReceiptLedger();
    const publicClient = createMockClient({ memoLogs: [], receiptLogs: [] });

    expect(
      () =>
        new ReceiptWatcher({
          ledger,
          publicClient,
          maxBlocksPerPoll: 5,
          cursorOverlap: 5,
        }),
    ).toThrow('cursorOverlap must be smaller than maxBlocksPerPoll');
  });

  it('creates a receipt when it sees matching Memo and ERC-20 Transfer logs', async () => {
    const ledger = new ReceiptLedger();
    const invoice = ledger.createInvoice({ id: 'inv_watch', amount: '19.00', payTo: seller });
    const request = createMemoPaymentRequest(invoice);
    const onReceipt = vi.fn();
    const publicClient = createMockClient({
      memoLogs: [memoLog(request)],
      receiptLogs: [transferLog({ value: 19_000_000n })],
    });
    const watcher = new ReceiptWatcher({ ledger, publicClient, onReceipt });

    watcher.watchInvoice(invoice, { fromBlock: 10n });
    const receipts = await watcher.pollOnce();

    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.invoiceId).toBe(invoice.id);
    expect(receipts[0]?.txHash).toBe(txHash);
    expect(receipts[0]?.amountUnits).toBe('19000000');
    expect(receipts[0]?.onchainProof).toMatchObject({
      chainId: 5042002,
      txHash,
      memoContract: request.memoContract,
      memoIndex: '1',
      memoId: request.memoId,
      callDataHash: request.callDataHash,
      payer: buyer,
      payTo: seller,
      target: request.target,
      amountUnits: '19000000',
    });
    expect(ledger.getInvoice(invoice.id)?.status).toBe('paid');
    expect(onReceipt).toHaveBeenCalledOnce();
  });

  it('ignores native USDC system Transfer logs to avoid double-counting', async () => {
    const ledger = new ReceiptLedger();
    const invoice = ledger.createInvoice({ id: 'inv_native_only', amount: '19.00', payTo: seller });
    const request = createMemoPaymentRequest(invoice);
    const publicClient = createMockClient({
      memoLogs: [memoLog(request)],
      receiptLogs: [
        transferLog({
          address: ARC_TESTNET_CONTRACTS.nativeUsdcSystemEmitter,
          value: 19_000_000_000_000_000_000n,
        }),
      ],
    });
    const watcher = new ReceiptWatcher({ ledger, publicClient });

    watcher.watchInvoice(invoice, { fromBlock: 10n });
    const receipts = await watcher.pollOnce();

    expect(receipts).toHaveLength(0);
    expect(ledger.getInvoice(invoice.id)?.status).toBe('open');
  });

  it('ignores memo logs with the wrong calldata hash', async () => {
    const ledger = new ReceiptLedger();
    const invoice = ledger.createInvoice({ id: 'inv_wrong_hash', amount: '19.00', payTo: seller });
    const request = createMemoPaymentRequest(invoice);
    const publicClient = createMockClient({
      memoLogs: [
        memoLog({
          ...request,
          callDataHash:
            '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' as `0x${string}`,
        }),
      ],
      receiptLogs: [transferLog({ value: 19_000_000n })],
    });
    const watcher = new ReceiptWatcher({ ledger, publicClient });

    watcher.watchInvoice(invoice, { fromBlock: 10n });
    const receipts = await watcher.pollOnce();

    expect(receipts).toHaveLength(0);
  });

  it('resumes polling from a persisted watcher cursor', async () => {
    const store = new InMemoryReceiptStore();
    const firstLedger = new ReceiptLedger();
    const invoice = firstLedger.createInvoice({ id: 'inv_cursor', amount: '19.00', payTo: seller });
    const request = createMemoPaymentRequest(invoice);
    const cursorKey = createWatcherCursorKey({
      network: invoice.network,
      invoiceId: invoice.id,
      memoId: request.memoId,
    });
    const firstClient = createMockClient({
      memoLogs: [],
      receiptLogs: [],
    });
    const firstWatcher = new ReceiptWatcher({
      ledger: firstLedger,
      publicClient: firstClient,
      cursorStore: store,
    });

    firstWatcher.watchInvoice(invoice, { fromBlock: 10n });
    await firstWatcher.pollOnce();

    expect((await store.getWatcherCursor(cursorKey))?.nextFromBlock).toBe(12n);

    const secondLedger = new ReceiptLedger();
    secondLedger.addInvoice(invoice);
    const secondClient = createMockClient({
      latestBlock: 14n,
      memoLogs: [],
      receiptLogs: [],
    });
    const secondWatcher = new ReceiptWatcher({
      ledger: secondLedger,
      publicClient: secondClient,
      cursorStore: store,
    });

    secondWatcher.watchInvoice(invoice);
    await secondWatcher.pollOnce();

    expect(secondClient.getLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        fromBlock: 12n,
        toBlock: 13n,
      }),
    );
  });

  it('validates Arc chain id before scanning', async () => {
    const ledger = new ReceiptLedger();
    const invoice = ledger.createInvoice({ id: 'inv_chain', amount: '1', payTo: seller });
    const publicClient = {
      ...createMockClient({ memoLogs: [], receiptLogs: [] }),
      getChainId: vi.fn().mockResolvedValue(1),
    };
    const watcher = new ReceiptWatcher({ ledger, publicClient });

    watcher.watchInvoice(invoice, { fromBlock: 10n });
    await expect(watcher.pollOnce()).rejects.toThrow(
      'Receipt watcher chain mismatch: expected 5042002, got 1',
    );
    expect(publicClient.getLogs).not.toHaveBeenCalled();
  });

  it('retries transient RPC failures and catches up within a bounded poll budget', async () => {
    const store = new InMemoryReceiptStore();
    const ledger = new ReceiptLedger();
    const invoice = ledger.createInvoice({ id: 'inv_ranges', amount: '1', payTo: seller });
    const publicClient = createMockClient({
      latestBlock: 20n,
      memoLogs: [],
      receiptLogs: [],
    });
    publicClient.getBlockNumber
      .mockRejectedValueOnce(new Error('temporary RPC failure'))
      .mockResolvedValue(20n);
    const watcher = new ReceiptWatcher({
      ledger,
      publicClient,
      cursorStore: store,
      maxBlockRange: 3,
      maxBlocksPerPoll: 6,
      cursorOverlap: 2,
      retryAttempts: 2,
      retryBaseDelayMs: 0,
    });

    watcher.watchInvoice(invoice, { fromBlock: 10n });
    await watcher.pollOnce();

    expect(publicClient.getBlockNumber).toHaveBeenCalledTimes(2);
    expect(
      publicClient.getLogs.mock.calls.map(([query]) => [query.fromBlock, query.toBlock]),
    ).toEqual([
      [10n, 12n],
      [13n, 15n],
    ]);
    const request = createMemoPaymentRequest(invoice);
    const cursor = await store.getWatcherCursor(
      createWatcherCursorKey({
        network: invoice.network,
        invoiceId: invoice.id,
        memoId: request.memoId,
      }),
    );
    expect(cursor?.nextFromBlock).toBe(14n);

    await watcher.pollOnce();
    expect(
      publicClient.getLogs.mock.calls.map(([query]) => [query.fromBlock, query.toBlock]),
    ).toEqual([
      [10n, 12n],
      [13n, 15n],
      [14n, 16n],
      [17n, 19n],
    ]);
    expect(
      (
        await store.getWatcherCursor(
          createWatcherCursorKey({
            network: invoice.network,
            invoiceId: invoice.id,
            memoId: request.memoId,
          }),
        )
      )?.nextFromBlock,
    ).toBe(18n);
  });
});

function createMockClient(params: {
  memoLogs: unknown[];
  receiptLogs: unknown[];
  latestBlock?: bigint;
}) {
  return {
    getBlockNumber: vi.fn().mockResolvedValue(params.latestBlock ?? 12n),
    getLogs: vi.fn().mockResolvedValue(params.memoLogs),
    getTransactionReceipt: vi.fn().mockResolvedValue({
      status: 'success',
      blockNumber: 10n,
      transactionIndex: 0,
      logs: [
        ...params.memoLogs.map((log) => memoReceiptLog((log as ReturnType<typeof memoLog>).args)),
        ...params.receiptLogs,
      ],
    }),
  } as any;
}

function memoLog(request: {
  target: `0x${string}`;
  memoId: `0x${string}`;
  memoData: `0x${string}`;
  callDataHash: `0x${string}`;
}) {
  return {
    address: ARC_TESTNET_CONTRACTS.memo,
    transactionHash: txHash,
    blockNumber: 10n,
    args: {
      sender: buyer,
      target: request.target,
      callDataHash: request.callDataHash,
      memoId: request.memoId,
      memo: request.memoData,
      memoIndex: 1n,
    },
  };
}

function memoReceiptLog(args: {
  target?: `0x${string}`;
  memoId?: `0x${string}`;
  memo?: `0x${string}`;
  callDataHash?: `0x${string}`;
  memoIndex?: bigint;
}) {
  if (!memoEvent || !args.target || !args.memoId || !args.memo || !args.callDataHash) {
    throw new Error('Invalid memo log fixture');
  }

  const topics = encodeEventTopics({
    abi: [memoEvent],
    eventName: 'Memo',
    args: { sender: buyer, target: args.target, memoId: args.memoId },
  });

  return {
    address: ARC_TESTNET_CONTRACTS.memo,
    topics,
    data: encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes' }, { type: 'uint256' }],
      [args.callDataHash, args.memo, args.memoIndex ?? 1n],
    ),
    blockNumber: 10n,
    blockHash,
    transactionHash: txHash,
    transactionIndex: 0,
    logIndex: 1,
    removed: false,
  };
}

function transferLog(params: { address?: `0x${string}`; value: bigint }) {
  const topics = encodeEventTopics({
    abi: [transferEvent],
    eventName: 'Transfer',
    args: { from: buyer, to: seller },
  });

  return {
    address: params.address ?? ARC_TESTNET_CONTRACTS.usdc,
    topics,
    data: encodeAbiParameters([{ type: 'uint256' }], [params.value]),
    blockNumber: 10n,
    blockHash,
    transactionHash: txHash,
    transactionIndex: 0,
    logIndex: 0,
    removed: false,
  };
}
