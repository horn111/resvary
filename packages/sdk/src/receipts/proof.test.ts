import { describe, expect, it, vi } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from 'viem';
import { ARC_TESTNET, ARC_TESTNET_CONTRACTS } from '../constants.js';
import { createInvoice } from './invoice.js';
import { ARC_MEMO_ABI, createMemoPaymentRequest } from './memo-payment.js';
import {
  MemoPaymentProofError,
  findMemoPaymentProof,
  verifyMemoPaymentProof,
  type VerifyMemoPaymentProofFailureReason,
} from './proof.js';

const seller = '0x1111111111111111111111111111111111111111' as const;
const buyer = '0x2222222222222222222222222222222222222222' as const;
const other = '0x3333333333333333333333333333333333333333' as const;
const txHash = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
const blockHash = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const;
const transferEvent = parseAbiItem(
  'event Transfer(address indexed from,address indexed to,uint256 value)',
);
const memoEvent = ARC_MEMO_ABI.find((item) => item.type === 'event' && item.name === 'Memo');

describe('verifyMemoPaymentProof', () => {
  it('returns an onchain proof for a valid Arc Memo USDC payment tx', async () => {
    const invoice = createInvoice({ id: 'inv_proof', amount: '19.00', payTo: seller });
    const request = createMemoPaymentRequest(invoice);
    const client = createMockClient({
      logs: [transferLog({ to: seller, value: 19_000_000n }), memoReceiptLog(request)],
    });

    const proof = await verifyMemoPaymentProof({
      txHash,
      paymentRequest: request,
      publicClient: client,
      verifiedAt: 1_700_000_000_000,
    });

    expect(proof).toMatchObject({
      chainId: ARC_TESTNET.chainId,
      network: 'arc-testnet',
      txHash,
      blockNumber: 10n,
      transactionIndex: 0,
      logIndex: 1,
      memoContract: request.memoContract,
      memoIndex: '42',
      memoId: request.memoId,
      callDataHash: request.callDataHash,
      payer: buyer,
      payTo: seller,
      target: request.target,
      amountUnits: '19000000',
      explorerUrl: `${ARC_TESTNET.explorerUrl}/tx/${txHash}`,
      verifiedAt: 1_700_000_000_000,
    });
  });

  it('fails when the tx reverted', async () => {
    const invoice = createInvoice({ id: 'inv_reverted', amount: '19.00', payTo: seller });
    const request = createMemoPaymentRequest(invoice);
    const client = createMockClient({
      status: 'reverted',
      logs: [memoReceiptLog(request), transferLog({ to: seller, value: 19_000_000n })],
    });

    await expectProofFailure(
      verifyMemoPaymentProof({ txHash, paymentRequest: request, publicClient: client }),
      'tx_reverted',
    );
  });

  it('fails when the Memo event has the wrong memo id', async () => {
    const invoice = createInvoice({ id: 'inv_wrong_memo', amount: '19.00', payTo: seller });
    const request = createMemoPaymentRequest(invoice);
    const client = createMockClient({
      logs: [
        memoReceiptLog({
          ...request,
          memoId: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        }),
        transferLog({ to: seller, value: 19_000_000n }),
      ],
    });

    await expectProofFailure(
      verifyMemoPaymentProof({ txHash, paymentRequest: request, publicClient: client }),
      'memo_id_mismatch',
    );
  });

  it('fails when the Memo event has the wrong calldata hash', async () => {
    const invoice = createInvoice({ id: 'inv_wrong_hash', amount: '19.00', payTo: seller });
    const request = createMemoPaymentRequest(invoice);
    const client = createMockClient({
      logs: [
        memoReceiptLog({
          ...request,
          callDataHash: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        }),
        transferLog({ to: seller, value: 19_000_000n }),
      ],
    });

    await expectProofFailure(
      verifyMemoPaymentProof({ txHash, paymentRequest: request, publicClient: client }),
      'call_data_hash_mismatch',
    );
  });

  it('fails when no USDC transfer is present', async () => {
    const invoice = createInvoice({ id: 'inv_missing_transfer', amount: '19.00', payTo: seller });
    const request = createMemoPaymentRequest(invoice);
    const client = createMockClient({ logs: [memoReceiptLog(request)] });

    await expectProofFailure(
      verifyMemoPaymentProof({ txHash, paymentRequest: request, publicClient: client }),
      'missing_transfer',
    );
  });

  it('fails when the transfer recipient is wrong', async () => {
    const invoice = createInvoice({ id: 'inv_wrong_recipient', amount: '19.00', payTo: seller });
    const request = createMemoPaymentRequest(invoice);
    const client = createMockClient({
      logs: [memoReceiptLog(request), transferLog({ to: other, value: 19_000_000n })],
    });

    await expectProofFailure(
      verifyMemoPaymentProof({ txHash, paymentRequest: request, publicClient: client }),
      'recipient_mismatch',
    );
  });

  it('fails when the transfer amount is wrong', async () => {
    const invoice = createInvoice({ id: 'inv_wrong_amount', amount: '19.00', payTo: seller });
    const request = createMemoPaymentRequest(invoice);
    const client = createMockClient({
      logs: [memoReceiptLog(request), transferLog({ to: seller, value: 18_000_000n })],
    });

    await expectProofFailure(
      verifyMemoPaymentProof({ txHash, paymentRequest: request, publicClient: client }),
      'amount_mismatch',
    );
  });
});

describe('findMemoPaymentProof', () => {
  it('returns pending when no Memo logs are found', async () => {
    const invoice = createInvoice({ id: 'inv_poll_pending', amount: '19.00', payTo: seller });
    const request = createMemoPaymentRequest(invoice);
    const client = createPollingMockClient({ memoLogs: [], receiptLogs: [] });

    const result = await findMemoPaymentProof({
      paymentRequest: request,
      publicClient: client,
      fromBlock: 10n,
      toBlock: 12n,
      confirmations: 0,
    });

    expect(result).toEqual({
      status: 'pending',
      fromBlock: 10n,
      toBlock: 12n,
      nextFromBlock: 13n,
      scannedLogCount: 0,
    });
  });

  it('returns a verified proof when a matching Memo tx is found', async () => {
    const invoice = createInvoice({ id: 'inv_poll_found', amount: '19.00', payTo: seller });
    const request = createMemoPaymentRequest(invoice);
    const client = createPollingMockClient({
      memoLogs: [{ transactionHash: txHash }],
      receiptLogs: [memoReceiptLog(request), transferLog({ to: seller, value: 19_000_000n })],
    });

    const result = await findMemoPaymentProof({
      paymentRequest: request,
      publicClient: client,
      fromBlock: 10n,
      toBlock: 12n,
      confirmations: 0,
      verifiedAt: 1_700_000_000_000,
    });

    expect(result).toMatchObject({
      status: 'found',
      txHash,
      fromBlock: 10n,
      toBlock: 12n,
      nextFromBlock: 13n,
      scannedLogCount: 1,
      proof: {
        txHash,
        memoId: request.memoId,
        explorerUrl: `${ARC_TESTNET.explorerUrl}/tx/${txHash}`,
      },
    });
  });

  it('bounds an explicit historical range and returns a continuation block', async () => {
    const invoice = createInvoice({ id: 'inv_poll_bounded', amount: '19.00', payTo: seller });
    const request = createMemoPaymentRequest(invoice);
    const client = createPollingMockClient({ memoLogs: [], receiptLogs: [] });

    const result = await findMemoPaymentProof({
      paymentRequest: request,
      publicClient: client,
      fromBlock: 0n,
      toBlock: 20_000n,
      confirmations: 0,
      maxBlockRange: 5_000n,
    });

    expect(result).toMatchObject({
      status: 'pending',
      fromBlock: 0n,
      toBlock: 4_999n,
      nextFromBlock: 5_000n,
    });
    expect(client.getLogs).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: 0n, toBlock: 4_999n }),
    );
  });

  it('rejects a non-positive scan budget', async () => {
    const invoice = createInvoice({
      id: 'inv_poll_invalid_budget',
      amount: '19.00',
      payTo: seller,
    });
    const request = createMemoPaymentRequest(invoice);
    const client = createPollingMockClient({ memoLogs: [], receiptLogs: [] });

    await expect(
      findMemoPaymentProof({
        paymentRequest: request,
        publicClient: client,
        fromBlock: 0n,
        toBlock: 12n,
        maxBlockRange: 0,
      }),
    ).rejects.toThrow('maxBlockRange must be positive');
    expect(client.getLogs).not.toHaveBeenCalled();
  });
});

function createMockClient(params: { status?: string; logs: unknown[] }) {
  return {
    getTransactionReceipt: vi.fn().mockResolvedValue({
      status: params.status ?? 'success',
      blockNumber: 10n,
      transactionIndex: 0,
      logs: params.logs,
    }),
  } as any;
}

function createPollingMockClient(params: {
  memoLogs: unknown[];
  receiptLogs: unknown[];
  status?: string;
}) {
  return {
    getBlockNumber: vi.fn().mockResolvedValue(12n),
    getLogs: vi.fn().mockResolvedValue(params.memoLogs),
    getTransactionReceipt: vi.fn().mockResolvedValue({
      status: params.status ?? 'success',
      blockNumber: 10n,
      transactionIndex: 0,
      logs: params.receiptLogs,
    }),
  } as any;
}

function memoReceiptLog(request: {
  target: `0x${string}`;
  memoId: `0x${string}`;
  memoData: `0x${string}`;
  callDataHash: `0x${string}`;
}) {
  if (!memoEvent) {
    throw new Error('Memo event ABI missing');
  }

  const topics = encodeEventTopics({
    abi: [memoEvent],
    eventName: 'Memo',
    args: { sender: buyer, target: request.target, memoId: request.memoId },
  });

  return {
    address: ARC_TESTNET_CONTRACTS.memo,
    topics,
    data: encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes' }, { type: 'uint256' }],
      [request.callDataHash, request.memoData, 42n],
    ),
    blockNumber: 10n,
    blockHash,
    transactionHash: txHash,
    transactionIndex: 0,
    logIndex: 1,
    removed: false,
  };
}

function transferLog(params: { to: `0x${string}`; value: bigint }) {
  const topics = encodeEventTopics({
    abi: [transferEvent],
    eventName: 'Transfer',
    args: { from: buyer, to: params.to },
  });

  return {
    address: ARC_TESTNET_CONTRACTS.usdc,
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

async function expectProofFailure(
  promise: Promise<unknown>,
  reason: VerifyMemoPaymentProofFailureReason,
) {
  await expect(promise).rejects.toMatchObject({
    name: 'MemoPaymentProofError',
    reason,
  } satisfies Partial<MemoPaymentProofError>);
}
