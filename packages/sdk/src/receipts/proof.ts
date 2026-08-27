/**
 * Read-only Arc Testnet proof verification for Memo-wrapped receipt payments.
 */

import { createPublicClient, getAddress, http, parseAbiItem, parseEventLogs, type Log } from 'viem';
import { ARC_TESTNET } from '../constants.js';
import { ARC_MEMO_ABI, ERC20_TRANSFER_ABI } from './memo-payment.js';
import type { ReceiptOnchainProof, MemoPaymentRequest } from './types.js';

export type ProofTransactionReceipt = {
  status: string;
  blockNumber: bigint;
  transactionIndex?: number;
  logs: readonly Log[];
};

export type ProofMemoLog = {
  transactionHash?: `0x${string}` | null;
};

export type ProofClient = {
  getTransactionReceipt: (params: {
    hash: `0x${string}`;
  }) => Promise<ProofTransactionReceipt | null>;
};

export type ProofPollingClient = ProofClient & {
  getBlockNumber: () => Promise<bigint>;
  getLogs: (params: {
    address: `0x${string}`;
    event: unknown;
    args: { memoId: `0x${string}` };
    fromBlock: bigint;
    toBlock: bigint;
  }) => Promise<readonly ProofMemoLog[]>;
};

const MEMO_EVENT = parseAbiItem(
  'event Memo(address indexed sender,address indexed target,bytes32 callDataHash,bytes32 indexed memoId,bytes memo,uint256 memoIndex)',
);

const DEFAULT_PROOF_LOOKBACK_BLOCKS = 5_000n;

export type VerifyMemoPaymentProofFailureReason =
  | 'tx_not_found'
  | 'tx_reverted'
  | 'wrong_memo_contract'
  | 'missing_memo_event'
  | 'memo_id_mismatch'
  | 'target_mismatch'
  | 'call_data_hash_mismatch'
  | 'missing_transfer'
  | 'recipient_mismatch'
  | 'amount_mismatch';

export class MemoPaymentProofError extends Error {
  readonly reason: VerifyMemoPaymentProofFailureReason;

  constructor(reason: VerifyMemoPaymentProofFailureReason, message: string) {
    super(message);
    this.name = 'MemoPaymentProofError';
    this.reason = reason;
  }
}

export interface VerifyMemoPaymentProofInput {
  txHash: `0x${string}`;
  paymentRequest: MemoPaymentRequest;
  rpcUrl?: string;
  publicClient?: ProofClient;
  verifiedAt?: number;
}

export interface VerifyMemoPaymentProofResult {
  proof: ReceiptOnchainProof;
}

export interface FindMemoPaymentProofInput {
  paymentRequest: MemoPaymentRequest;
  rpcUrl?: string;
  publicClient?: ProofPollingClient;
  fromBlock?: bigint;
  toBlock?: bigint;
  confirmations?: number;
  lookbackBlocks?: bigint | number;
  verifiedAt?: number;
}

export type FindMemoPaymentProofResult =
  | {
      status: 'found';
      proof: ReceiptOnchainProof;
      txHash: `0x${string}`;
      fromBlock: bigint;
      toBlock: bigint;
      nextFromBlock: bigint;
      scannedLogCount: number;
    }
  | {
      status: 'pending';
      fromBlock: bigint;
      toBlock: bigint;
      nextFromBlock: bigint;
      scannedLogCount: number;
    };

type ProofSearchRange = {
  fromBlock: bigint;
  toBlock: bigint;
};

type MemoProofCandidateResult =
  | {
      status: 'found';
      proof: ReceiptOnchainProof;
      txHash: `0x${string}`;
    }
  | {
      status: 'pending';
      lastError?: MemoPaymentProofError;
    };

export async function verifyMemoPaymentProof(
  input: VerifyMemoPaymentProofInput,
): Promise<ReceiptOnchainProof> {
  const client =
    input.publicClient ??
    createPublicClient({
      transport: http(input.rpcUrl ?? ARC_TESTNET.rpcUrl),
    });

  let txReceipt: ProofTransactionReceipt | null;
  try {
    txReceipt = await client.getTransactionReceipt({ hash: input.txHash });
  } catch {
    throw new MemoPaymentProofError(
      'tx_not_found',
      `Transaction ${input.txHash} was not found on Arc Testnet`,
    );
  }

  if (!txReceipt) {
    throw new MemoPaymentProofError(
      'tx_not_found',
      `Transaction ${input.txHash} was not found on Arc Testnet`,
    );
  }

  return createMemoPaymentProofFromReceipt({
    txHash: input.txHash,
    paymentRequest: input.paymentRequest,
    txReceipt,
    verifiedAt: input.verifiedAt,
  });
}

export async function findMemoPaymentProof(
  input: FindMemoPaymentProofInput,
): Promise<FindMemoPaymentProofResult> {
  const client = (input.publicClient ??
    createPublicClient({
      transport: http(input.rpcUrl ?? ARC_TESTNET.rpcUrl),
    })) as ProofPollingClient;
  const { fromBlock, toBlock } = await resolveProofSearchRange(input, client);

  if (fromBlock > toBlock) {
    return {
      status: 'pending',
      fromBlock,
      toBlock,
      nextFromBlock: fromBlock,
      scannedLogCount: 0,
    };
  }

  const memoLogs = await getMemoProofLogs(input.paymentRequest, client, { fromBlock, toBlock });
  const candidate = await verifyMemoProofCandidates(input, client, memoLogs);

  if (candidate.status === 'found') {
    return {
      status: 'found',
      proof: candidate.proof,
      txHash: candidate.txHash,
      fromBlock,
      toBlock,
      nextFromBlock: toBlock + 1n,
      scannedLogCount: memoLogs.length,
    };
  }

  if (candidate.lastError) {
    throw candidate.lastError;
  }

  return {
    status: 'pending',
    fromBlock,
    toBlock,
    nextFromBlock: toBlock + 1n,
    scannedLogCount: memoLogs.length,
  };
}

async function resolveProofSearchRange(
  input: FindMemoPaymentProofInput,
  client: ProofPollingClient,
): Promise<ProofSearchRange> {
  const confirmations = BigInt(input.confirmations ?? 1);
  const latestBlock = input.toBlock ?? (await client.getBlockNumber());
  const toBlock = latestBlock > confirmations ? latestBlock - confirmations : 0n;
  const lookbackBlocks =
    input.lookbackBlocks === undefined
      ? DEFAULT_PROOF_LOOKBACK_BLOCKS
      : BigInt(input.lookbackBlocks);

  return {
    fromBlock: input.fromBlock ?? defaultProofFromBlock(toBlock, lookbackBlocks),
    toBlock,
  };
}

function defaultProofFromBlock(toBlock: bigint, lookbackBlocks: bigint): bigint {
  return toBlock > lookbackBlocks ? toBlock - lookbackBlocks : 0n;
}

async function getMemoProofLogs(
  paymentRequest: MemoPaymentRequest,
  client: ProofPollingClient,
  range: ProofSearchRange,
): Promise<readonly ProofMemoLog[]> {
  return client.getLogs({
    address: paymentRequest.memoContract,
    event: MEMO_EVENT,
    args: { memoId: paymentRequest.memoId },
    fromBlock: range.fromBlock,
    toBlock: range.toBlock,
  });
}

async function verifyMemoProofCandidates(
  input: FindMemoPaymentProofInput,
  client: ProofPollingClient,
  memoLogs: readonly ProofMemoLog[],
): Promise<MemoProofCandidateResult> {
  let lastError: MemoPaymentProofError | undefined;

  for (const memoLog of memoLogs) {
    const result = await verifyMemoProofCandidate(input, client, memoLog);
    if (result.status === 'found') {
      return result;
    }

    lastError = result.lastError ?? lastError;
  }

  return { status: 'pending', lastError };
}

async function verifyMemoProofCandidate(
  input: FindMemoPaymentProofInput,
  client: ProofPollingClient,
  memoLog: ProofMemoLog,
): Promise<MemoProofCandidateResult> {
  const txHash = memoLog.transactionHash;
  if (!txHash) {
    return { status: 'pending' };
  }

  try {
    const proof = await verifyMemoPaymentProof({
      txHash,
      paymentRequest: input.paymentRequest,
      publicClient: client,
      verifiedAt: input.verifiedAt,
    });

    return { status: 'found', proof, txHash };
  } catch (error) {
    if (error instanceof MemoPaymentProofError) {
      return { status: 'pending', lastError: error };
    }

    throw error;
  }
}

export function createMemoPaymentProofFromReceipt(params: {
  txHash: `0x${string}`;
  paymentRequest: MemoPaymentRequest;
  txReceipt: ProofTransactionReceipt;
  verifiedAt?: number;
}): ReceiptOnchainProof {
  const { paymentRequest, txHash, txReceipt } = params;

  if (txReceipt.status !== 'success') {
    throw new MemoPaymentProofError('tx_reverted', `Transaction ${txHash} did not succeed`);
  }

  const memoLogs = txReceipt.logs.filter((log) =>
    sameAddress(log.address, paymentRequest.memoContract),
  );
  if (memoLogs.length === 0) {
    throw new MemoPaymentProofError(
      'wrong_memo_contract',
      `Transaction ${txHash} has no logs from Memo contract ${paymentRequest.memoContract}`,
    );
  }

  const parsedMemoLogs = parseEventLogs({
    abi: ARC_MEMO_ABI,
    eventName: 'Memo',
    logs: memoLogs,
    strict: false,
  });

  if (parsedMemoLogs.length === 0) {
    throw new MemoPaymentProofError(
      'missing_memo_event',
      `Transaction ${txHash} has no Memo event`,
    );
  }

  const memoById = parsedMemoLogs.find((log) => {
    const args = log.args as {
      memoId?: `0x${string}`;
    };
    return args.memoId?.toLowerCase() === paymentRequest.memoId.toLowerCase();
  });

  if (!memoById) {
    throw new MemoPaymentProofError(
      'memo_id_mismatch',
      `Transaction ${txHash} does not contain memoId ${paymentRequest.memoId}`,
    );
  }

  const memoArgs = memoById.args as {
    sender?: `0x${string}`;
    target?: `0x${string}`;
    callDataHash?: `0x${string}`;
    memoId?: `0x${string}`;
    memoIndex?: bigint;
  };

  if (!memoArgs.sender || !memoArgs.target || !memoArgs.callDataHash || !memoArgs.memoId) {
    throw new MemoPaymentProofError(
      'missing_memo_event',
      `Transaction ${txHash} has an incomplete Memo event`,
    );
  }

  if (!sameAddress(memoArgs.target, paymentRequest.target)) {
    throw new MemoPaymentProofError(
      'target_mismatch',
      `Memo target ${memoArgs.target} does not match ${paymentRequest.target}`,
    );
  }

  if (memoArgs.callDataHash.toLowerCase() !== paymentRequest.callDataHash.toLowerCase()) {
    throw new MemoPaymentProofError(
      'call_data_hash_mismatch',
      `Memo callDataHash ${memoArgs.callDataHash} does not match ${paymentRequest.callDataHash}`,
    );
  }

  const transferLogs = txReceipt.logs.filter((log) =>
    sameAddress(log.address, paymentRequest.target),
  );
  const parsedTransferLogs = parseEventLogs({
    abi: ERC20_TRANSFER_ABI,
    eventName: 'Transfer',
    logs: transferLogs,
    strict: false,
  });

  if (parsedTransferLogs.length === 0) {
    throw new MemoPaymentProofError(
      'missing_transfer',
      `Transaction ${txHash} has no USDC Transfer event`,
    );
  }

  const payerTransfers = parsedTransferLogs.filter((log) => {
    const args = log.args as {
      from?: `0x${string}`;
    };
    return args.from !== undefined && sameAddress(args.from, memoArgs.sender as `0x${string}`);
  });

  if (payerTransfers.length === 0) {
    throw new MemoPaymentProofError(
      'missing_transfer',
      `Transaction ${txHash} has no USDC Transfer from memo sender ${memoArgs.sender}`,
    );
  }

  const recipientTransfers = payerTransfers.filter((log) => {
    const args = log.args as {
      to?: `0x${string}`;
    };
    return args.to !== undefined && sameAddress(args.to, paymentRequest.payTo);
  });

  if (recipientTransfers.length === 0) {
    throw new MemoPaymentProofError(
      'recipient_mismatch',
      `Transaction ${txHash} has no USDC Transfer to ${paymentRequest.payTo}`,
    );
  }

  const amountTransfer = recipientTransfers.find((log) => {
    const args = log.args as {
      value?: bigint;
    };
    return args.value?.toString() === paymentRequest.amountUnits;
  });

  if (!amountTransfer) {
    throw new MemoPaymentProofError(
      'amount_mismatch',
      `Transaction ${txHash} has no USDC Transfer for ${paymentRequest.amountUnits} units`,
    );
  }

  return {
    chainId: ARC_TESTNET.chainId,
    network: 'arc-testnet',
    txHash,
    blockNumber: txReceipt.blockNumber,
    transactionIndex: txReceipt.transactionIndex ?? numberOrUndefined(memoById.transactionIndex),
    logIndex: numberOrUndefined(memoById.logIndex),
    memoContract: paymentRequest.memoContract,
    memoIndex: memoArgs.memoIndex?.toString(),
    memoId: paymentRequest.memoId,
    callDataHash: paymentRequest.callDataHash,
    payer: getAddress(memoArgs.sender) as `0x${string}`,
    payTo: getAddress(paymentRequest.payTo) as `0x${string}`,
    target: getAddress(paymentRequest.target) as `0x${string}`,
    amountUnits: paymentRequest.amountUnits,
    explorerUrl: `${ARC_TESTNET.explorerUrl}/tx/${txHash}`,
    verifiedAt: params.verifiedAt ?? Date.now(),
  };
}

function sameAddress(left: `0x${string}` | string, right: `0x${string}` | string): boolean {
  return getAddress(left as `0x${string}`) === getAddress(right as `0x${string}`);
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}
