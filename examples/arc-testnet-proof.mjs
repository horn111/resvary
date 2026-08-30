import { CreditLedger, creditUnitsToString } from '@resvary/sdk/credits';
import { ArcCreditFunding, ArcFundingWorker } from '@resvary/sdk/funding';
import { ARC_TESTNET } from '@resvary/sdk';
import { createSqliteCreditStore, createSqliteReceiptStore } from '@resvary/sqlite';
import { createPublicClient, createWalletClient, defineChain, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  createProofId,
  loadLocalEnv,
  requireAddress,
  requirePrivateKey,
  runUsageLifecycle,
  waitFor,
  writeEvidence,
} from './proof-utils.mjs';

loadLocalEnv();

const privateKey = requirePrivateKey(
  'RESVARY_ARC_BUYER_PRIVATE_KEY',
  'RESVARY_TESTNET_BUYER_PRIVATE_KEY',
);
const recipient = requireAddress('RESVARY_ARC_FUNDING_RECIPIENT', 'RESVARY_TESTNET_SELLER_ADDRESS');
const amount = process.env.RESVARY_ARC_PROOF_AMOUNT?.trim() || '0.01';
const rpcUrl = process.env.RESVARY_ARC_RPC_URL?.trim() || ARC_TESTNET.rpcUrl;
const proofId = createProofId('arc-proof');
const customerId = process.env.RESVARY_ARC_PROOF_CUSTOMER_ID?.trim() || 'arc_proof';
const dbPath = process.env.RESVARY_CREDITS_DB_PATH?.trim() || '.resvary/proof.sqlite';
const output =
  process.env.RESVARY_ARC_EVIDENCE_PATH?.trim() || 'docs/evidence/0.7.0/arc-testnet-proof.json';
const confirmations = Number(process.env.RESVARY_ARC_CONFIRMATIONS?.trim() || '1');
const recoverExisting = process.argv.includes('--recover');
if (!Number.isSafeInteger(confirmations) || confirmations < 1) {
  throw new Error('RESVARY_ARC_CONFIRMATIONS must be a positive integer');
}

const chain = defineChain({
  id: ARC_TESTNET.chainId,
  name: ARC_TESTNET.name,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  blockExplorers: { default: { name: 'Arcscan', url: ARC_TESTNET.explorerUrl } },
});
const account = privateKeyToAccount(privateKey);
const expectedBuyerAddress = process.env.RESVARY_TESTNET_BUYER_ADDRESS?.trim();
if (expectedBuyerAddress && account.address.toLowerCase() !== expectedBuyerAddress.toLowerCase()) {
  throw new Error(
    `Arc buyer private key resolves to ${account.address}, expected ${expectedBuyerAddress}`,
  );
}
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
const creditStore = createSqliteCreditStore({ path: dbPath });
const receiptStore = createSqliteReceiptStore({ path: dbPath });
const ledger = new CreditLedger({ projectId: 'resvary_arc_proof', store: creditStore });
const funding = new ArcCreditFunding({ ledger, payTo: recipient, receiptStore });
let fundingIntent;
let paymentRequest;
if (recoverExisting) {
  fundingIntent = (await ledger.listFundingIntents()).find(
    (intent) => intent.rail === 'arc_direct' && intent.metadata?.proofId === proofId,
  );
  if (!fundingIntent) {
    throw new Error(`No persisted Arc funding intent found for recovery proof ID ${proofId}`);
  }
} else {
  const fundingRequest = await funding.createFundingRequest({
    customerId,
    amount,
    idempotencyKey: `arc-proof-intent:${proofId}`,
    metadata: { mode: 'live_arc_testnet_proof', proofId },
  });
  fundingIntent = fundingRequest.fundingIntent;
  paymentRequest = fundingRequest.paymentRequest;
}

let fromBlock = await publicClient.getBlockNumber();
let resumedBeforePayment = [];
let recoveredIntents = [];
let observedReceipts = [];
let txHash;
let txReceipt;

if (recoverExisting) {
  const existingTransaction = (await ledger.listFundingTransactions(fundingIntent.id))[0];
  if (!existingTransaction?.txHash) {
    throw new Error(`No settled Arc transaction found for recovery proof ID ${proofId}`);
  }
  txHash = existingTransaction.txHash;
  txReceipt = await publicClient.getTransactionReceipt({ hash: txHash });
  fromBlock = txReceipt.blockNumber;
} else {
  // Simulate a process ending after the pending intent and invoice are durable.
  const prePaymentWorker = new ArcFundingWorker({
    ledger,
    receiptStore,
    payTo: recipient,
    rpcUrl,
    fromBlock,
    confirmations,
  });
  resumedBeforePayment = await prePaymentWorker.resumePendingIntents();
  prePaymentWorker.stop();

  txHash = await walletClient.sendTransaction({
    account,
    to: paymentRequest.memoContract,
    data: paymentRequest.txData,
    value: 0n,
  });
  txReceipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (txReceipt.status !== 'success') throw new Error(`Arc transaction reverted: ${txHash}`);

  await waitFor(async () => {
    const latest = await publicClient.getBlockNumber();
    return latest >= txReceipt.blockNumber + BigInt(confirmations) ? latest : undefined;
  });

  // A new worker process recovers the pending intent and scans the bounded block range.
  const recoveredWorker = new ArcFundingWorker({
    ledger,
    receiptStore,
    payTo: recipient,
    rpcUrl,
    fromBlock,
    confirmations,
    maxBlockRange: 500,
    cursorOverlap: 2,
  });
  recoveredIntents = await recoveredWorker.resumePendingIntents();
  observedReceipts = await recoveredWorker.pollOnce();
  recoveredWorker.stop();
}

const transaction = (await ledger.listFundingTransactions(fundingIntent.id))[0];
if (!transaction) throw new Error('Arc worker did not create a funding transaction');
const storedReceipt = (await receiptStore.listReceipts()).find(
  (receipt) => receipt.txHash?.toLowerCase() === txHash.toLowerCase(),
);
if (!storedReceipt) throw new Error('Arc worker did not persist the payment receipt');
const grant = await ledger.store.getGrant(transaction.grantId);
if (!grant) throw new Error('Arc worker funding transaction has no credit grant');
const balanceBeforeReplay = await ledger.getBalance(customerId);
const fundingLot = (await ledger.listCreditLots(customerId)).find(
  (lot) => lot.grantId === grant.id,
);
if (!fundingLot || fundingLot.kind !== 'general' || fundingLot.expiresAt !== undefined) {
  throw new Error('Arc funding did not create a non-expiring general credit lot');
}
const grantsBeforeReplay = await ledger.store.listGrants(balanceBeforeReplay.id);
const cursors = await receiptStore.listWatcherCursors();
if (cursors.length === 0) throw new Error('Arc worker did not persist a watcher cursor');

// Restart once more, then replay the same receipt. Neither operation may add credits.
const restartedWorker = new ArcFundingWorker({
  ledger,
  receiptStore,
  payTo: recipient,
  rpcUrl,
  fromBlock,
  confirmations,
});
const pendingAfterRestart = await restartedWorker.resumePendingIntents();
const reconciledAfterRestart = await restartedWorker.reconcile();
restartedWorker.stop();
await funding.confirmPayment({
  fundingIntentId: fundingIntent.id,
  receipt: storedReceipt,
  idempotencyKey: `arc-worker:${txHash.toLowerCase()}`,
  metadata: { source: 'arc-proof-replay', proofId },
});
const balanceAfterReplay = await ledger.getBalance(customerId);
const grantsAfterReplay = await ledger.store.listGrants(balanceAfterReplay.id);
if (balanceAfterReplay.availableUnits !== balanceBeforeReplay.availableUnits) {
  throw new Error('Arc replay changed the account balance');
}
if (grantsAfterReplay.length !== grantsBeforeReplay.length) {
  throw new Error('Arc replay created another credit grant');
}

const lifecycle = await runUsageLifecycle({
  dbPath,
  projectId: 'resvary_arc_proof',
  customerId,
  proofId,
});
const fundingEntry = (await ledger.listLedgerEntries(customerId)).find(
  (entry) => entry.referenceType === 'funding' && entry.referenceId === transaction.id,
);
const balanceAfterFunding = fundingEntry
  ? creditUnitsToString(BigInt(fundingEntry.balanceAfterUnits))
  : balanceBeforeReplay.availableAmount;
const evidence = {
  schemaVersion: 1,
  rail: 'arc_direct',
  testnetOnly: true,
  proofId,
  observedAt: new Date().toISOString(),
  network: transaction.network,
  chainId: ARC_TESTNET.chainId,
  txHash,
  explorerUrl: `${ARC_TESTNET.explorerUrl}/tx/${txHash}`,
  blockNumber: txReceipt.blockNumber.toString(),
  confirmations,
  payer: storedReceipt.payer,
  recipient,
  amount: transaction.amount,
  amountUnits: transaction.amountUnits,
  memoId: storedReceipt.onchainProof?.memoId,
  callDataHash: storedReceipt.onchainProof?.callDataHash,
  fundingIntentId: fundingIntent.id,
  paymentReceiptId: storedReceipt.id,
  fundingTransactionId: transaction.id,
  creditGrantId: grant.id,
  fundingLot: {
    kind: fundingLot.kind,
    expiresAt: fundingLot.expiresAt ?? null,
    originalAmount: fundingLot.originalAmount,
  },
  balanceAfterFunding,
  workerRecovery: {
    recoveredFromPersistedRun: recoverExisting,
    pendingIntentWasDurable:
      recoverExisting || resumedBeforePayment.some((intent) => intent.id === fundingIntent.id),
    recoveredIntentAfterRestart:
      (recoverExisting && cursors.length > 0) ||
      recoveredIntents.some((intent) => intent.id === fundingIntent.id),
    observedReceiptCount: recoverExisting ? 1 : observedReceipts.length,
    persistedCursorCount: cursors.length,
    pendingAfterFinalRestart: pendingAfterRestart.length,
    reconciledAfterFinalRestart: reconciledAfterRestart,
  },
  replay: {
    balanceUnchanged: balanceAfterReplay.availableUnits === balanceBeforeReplay.availableUnits,
    grantCountUnchanged: grantsAfterReplay.length === grantsBeforeReplay.length,
    observedBalanceBeforeReplay: balanceBeforeReplay.availableAmount,
    observedBalanceAfterReplay: balanceAfterReplay.availableAmount,
  },
  lifecycle,
  privacy: { privateKeyRecorded: false },
};

const outputPath = await writeEvidence(output, evidence);
console.log(`Arc proof complete: ${outputPath}`);
console.log(`Arcscan: ${evidence.explorerUrl}`);
console.log(`Funding transaction: ${transaction.id}`);
console.log(`Replay-safe balance: ${balanceAfterReplay.availableAmount}`);
