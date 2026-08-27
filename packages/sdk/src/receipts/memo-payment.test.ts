import { describe, expect, it } from 'vitest';
import { decodeFunctionData, keccak256 } from 'viem';
import { ARC_TESTNET_CONTRACTS } from '../constants.js';
import { createInvoice } from './invoice.js';
import { ARC_MEMO_ABI, createMemoPaymentRequest, ERC20_TRANSFER_ABI } from './memo-payment.js';

const seller = '0x1111111111111111111111111111111111111111' as const;

describe('memo payment requests', () => {
  it('builds a Memo.memo call around an ERC-20 USDC transfer', () => {
    const invoice = createInvoice({ id: 'inv_memo', amount: '19.00', payTo: seller });
    const request = createMemoPaymentRequest(invoice);

    expect(request.memoContract).toBe(ARC_TESTNET_CONTRACTS.memo);
    expect(request.target).toBe(ARC_TESTNET_CONTRACTS.usdc);
    expect(request.memoId).toBe(invoice.memoId);
    expect(request.memoData).toBe(invoice.memoData);
    expect(request.callDataHash).toBe(keccak256(request.data));

    const transferCall = decodeFunctionData({
      abi: ERC20_TRANSFER_ABI,
      data: request.data,
    });
    expect(transferCall.functionName).toBe('transfer');
    expect(transferCall.args).toEqual([seller, 19_000_000n]);

    const memoCall = decodeFunctionData({
      abi: ARC_MEMO_ABI,
      data: request.txData,
    });
    expect(memoCall.functionName).toBe('memo');
    expect(memoCall.args).toEqual([
      ARC_TESTNET_CONTRACTS.usdc,
      request.data,
      request.memoId,
      request.memoData,
    ]);
  });
});
