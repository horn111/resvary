import { createHash } from 'node:crypto';
import type {
  CreditLedger,
  FundingIntent,
  FundingTransaction,
  CreditAccount,
  CreditGrant,
} from '../credits/index.js';
import {
  createInvoice,
  createMemoPaymentRequest,
  type MemoPaymentRequest,
  type PaymentInvoice,
  type PaymentReceipt,
  type ReceiptStore,
} from '../receipts/index.js';

export interface ArcCreditFundingConfig {
  ledger: CreditLedger;
  payTo: `0x${string}`;
  network?: string;
  receiptStore?: ReceiptStore;
}

export interface ArcFundingRequest {
  fundingIntent: FundingIntent;
  invoice: PaymentInvoice;
  paymentRequest: MemoPaymentRequest;
}

export class ArcCreditFunding {
  private readonly ledger: CreditLedger;
  private readonly payTo: `0x${string}`;
  private readonly network: string;
  private readonly receiptStore?: ReceiptStore;

  constructor(config: ArcCreditFundingConfig) {
    this.ledger = config.ledger;
    this.payTo = config.payTo;
    this.network = config.network ?? 'arc-testnet';
    this.receiptStore = config.receiptStore;
  }

  async createFundingRequest(input: {
    customerId: string;
    amount: string;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  }): Promise<ArcFundingRequest> {
    const fundingIntentId = `fund_${createHash('sha256')
      .update(`${this.ledger.projectId}\u0000${input.customerId}\u0000${input.idempotencyKey}`)
      .digest('hex')
      .slice(0, 24)}`;
    const invoice = createInvoice({
      id: `inv_${fundingIntentId}`,
      amount: input.amount,
      currency: 'USDC',
      payTo: this.payTo,
      network: this.network,
      customerId: input.customerId,
      description: `Prepaid credits for ${input.customerId}`,
      metadata: { ...input.metadata, fundingIntentId },
    });
    const fundingIntent = await this.ledger.createFundingIntent({
      id: fundingIntentId,
      customerId: input.customerId,
      amount: input.amount,
      rail: 'arc_direct',
      network: this.network,
      invoiceId: invoice.id,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata,
    });

    await this.receiptStore?.saveInvoice(invoice);
    return { fundingIntent, invoice, paymentRequest: createMemoPaymentRequest(invoice) };
  }

  async confirmPayment(input: {
    fundingIntentId: string;
    receipt: PaymentReceipt;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  }): Promise<{
    account: CreditAccount;
    grant: CreditGrant;
    fundingIntent: FundingIntent;
    fundingTransaction: FundingTransaction;
  }> {
    const intent = await this.ledger.getFundingIntent(input.fundingIntentId);
    if (!intent) throw new Error(`Funding intent not found: ${input.fundingIntentId}`);
    if (input.receipt.invoiceId !== intent.invoiceId) {
      throw new Error('Payment receipt does not belong to the funding intent invoice');
    }
    if (input.receipt.network !== intent.network) {
      throw new Error('Payment receipt network does not match the funding intent');
    }
    if (input.receipt.payTo.toLowerCase() !== this.payTo.toLowerCase()) {
      throw new Error('Payment receipt recipient does not match the funding recipient');
    }
    if (!input.receipt.txHash) {
      throw new Error('Arc funding requires a payment receipt with a transaction hash');
    }

    return this.ledger.confirmFunding({
      fundingIntentId: intent.id,
      rail: 'arc_direct',
      network: input.receipt.network,
      externalPaymentId: input.receipt.txHash,
      txHash: input.receipt.txHash,
      amount: input.receipt.amount,
      paymentReceiptId: input.receipt.id,
      payer: input.receipt.payer,
      settlementStatus: 'settled',
      evidence: {
        payer: input.receipt.payer,
        recipient: input.receipt.payTo,
        explorerUrl: input.receipt.onchainProof?.explorerUrl,
        blockNumber: input.receipt.blockNumber?.toString(),
        metadata: {
          memoId: input.receipt.onchainProof?.memoId,
          callDataHash: input.receipt.onchainProof?.callDataHash,
        },
      },
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata,
    });
  }
}
