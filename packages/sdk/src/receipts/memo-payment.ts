/**
 * Helpers for Arc Memo-wrapped USDC invoice payments.
 */

import { encodeFunctionData, keccak256, type Abi } from 'viem';
import { ARC_TESTNET_CONTRACTS } from '../constants.js';
import { createInvoiceMemoData, createInvoiceMemoId } from './memo.js';
import type { PaymentInvoice, MemoPaymentRequest } from './types.js';

export const ERC20_TRANSFER_ABI = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'event',
    name: 'Transfer',
    anonymous: false,
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
] as const satisfies Abi;

export const ARC_MEMO_ABI = [
  {
    type: 'function',
    name: 'memo',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'data', type: 'bytes' },
      { name: 'memoId', type: 'bytes32' },
      { name: 'memoData', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'BeforeMemo',
    anonymous: false,
    inputs: [{ name: 'memoIndex', type: 'uint256', indexed: true }],
  },
  {
    type: 'event',
    name: 'Memo',
    anonymous: false,
    inputs: [
      { name: 'sender', type: 'address', indexed: true },
      { name: 'target', type: 'address', indexed: true },
      { name: 'callDataHash', type: 'bytes32', indexed: false },
      { name: 'memoId', type: 'bytes32', indexed: true },
      { name: 'memo', type: 'bytes', indexed: false },
      { name: 'memoIndex', type: 'uint256', indexed: false },
    ],
  },
] as const satisfies Abi;

export interface MemoPaymentRequestOptions {
  usdcAddress?: `0x${string}`;
  memoContract?: `0x${string}`;
}

export function createMemoPaymentRequest(
  invoice: PaymentInvoice,
  options: MemoPaymentRequestOptions = {},
): MemoPaymentRequest {
  const target = options.usdcAddress ?? ARC_TESTNET_CONTRACTS.usdc;
  const memoContract = options.memoContract ?? ARC_TESTNET_CONTRACTS.memo;
  const memoId = invoice.memoId ?? createInvoiceMemoId(invoice.id);
  const memoData = invoice.memoData ?? createInvoiceMemoData(invoice.memo);

  const data = encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: 'transfer',
    args: [invoice.payTo, BigInt(invoice.amountUnits)],
  });
  const callDataHash = keccak256(data);
  const txData = encodeFunctionData({
    abi: ARC_MEMO_ABI,
    functionName: 'memo',
    args: [target, data, memoId, memoData],
  });

  return {
    invoiceId: invoice.id,
    memoContract,
    target,
    data,
    txData,
    memoId,
    memoData,
    callDataHash,
    amountUnits: invoice.amountUnits,
    payTo: invoice.payTo,
  };
}
