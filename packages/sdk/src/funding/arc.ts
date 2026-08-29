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
  stablecoinUnitsToString,
  verifyMemoPaymentProof,
  type MemoPaymentRequest,
  type PaymentInvoice,
  type PaymentReceipt,
  type ProofClient,
  type ReceiptStore,
} from '../receipts/index.js';

export interface ArcCreditFundingConfig {
  ledger: CreditLedger;
  payTo: `0x${string}`;
  network?: string;
  receiptStore?: ReceiptStore;
  rpcUrl?: string;
  publicClient?: ProofClient;
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
  private readonly rpcUrl?: string;
  private readonly publicClient?: ProofClient;

  constructor(config: ArcCreditFundingConfig) {
    this.ledger = config.ledger;
    this.payTo = config.payTo;
    this.network = config.network ?? 'arc-testnet';
    this.receiptStore = config.receiptStore;
    this.rpcUrl = config.rpcUrl;
    this.publicClient = config.publicClient;
    if (this.network !== 'arc-testnet') {
      throw new Error('ArcCreditFunding currently supports Arc Testnet only');
    }
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
    const paymentRequest = this.createExpectedPaymentRequest(intent);
    const proof = await verifyMemoPaymentProof({
      txHash: input.receipt.txHash,
      paymentRequest,
      rpcUrl: this.rpcUrl,
      publicClient: this.publicClient,
    });
    if (proof.network !== intent.network) {
      throw new Error('Verified payment proof network does not match the funding intent');
    }

    return this.ledger.confirmFunding({
      fundingIntentId: intent.id,
      rail: 'arc_direct',
      network: proof.network,
      externalPaymentId: input.receipt.txHash,
      txHash: input.receipt.txHash,
      amount: stablecoinUnitsToString(BigInt(proof.amountUnits)),
      paymentReceiptId: input.receipt.id,
      payer: proof.payer,
      settlementStatus: 'settled',
      evidence: {
        payer: proof.payer,
        recipient: proof.payTo,
        explorerUrl: proof.explorerUrl,
        blockNumber: proof.blockNumber.toString(),
        metadata: {
          memoId: proof.memoId,
          callDataHash: proof.callDataHash,
        },
      },
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata,
    });
  }

  private createExpectedPaymentRequest(intent: FundingIntent): MemoPaymentRequest {
    return createMemoPaymentRequest(
      createInvoice({
        id: intent.invoiceId,
        amount: intent.requestedAmount,
        currency: 'USDC',
        payTo: this.payTo,
        network: intent.network,
      }),
    );
  }
}
