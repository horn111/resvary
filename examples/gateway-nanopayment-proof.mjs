import { GatewayClient } from '@circle-fin/x402-batching/client';
import { CreditLedger } from '@resvary/sdk/credits';
import { createSqliteCreditStore } from '@resvary/sqlite';
import {
  createProofId,
  loadLocalEnv,
  requirePrivateKey,
  runUsageLifecycle,
  writeEvidence,
} from './proof-utils.mjs';

loadLocalEnv();

const endpoint =
  process.env.RESVARY_GATEWAY_PROOF_URL?.trim() || 'http://localhost:3004/api/credits/gateway';
const privateKey = requirePrivateKey(
  'RESVARY_GATEWAY_BUYER_PRIVATE_KEY',
  'RESVARY_TESTNET_BUYER_PRIVATE_KEY',
);
const proofId = createProofId('gateway-proof');
const dbPath = process.env.RESVARY_CREDITS_DB_PATH?.trim() || '.resvary/proof.sqlite';
const output =
  process.env.RESVARY_GATEWAY_EVIDENCE_PATH?.trim() ||
  'docs/evidence/0.7.0/gateway-nanopayment-proof.json';
const demoAdminToken = process.env.RESVARY_DEMO_ADMIN_TOKEN?.trim();
if (!demoAdminToken) {
  throw new Error('RESVARY_DEMO_ADMIN_TOKEN is required by the demo Gateway proof route');
}
const adminHeaders = { authorization: `Bearer ${demoAdminToken}` };

const routeStatusResponse = await fetch(endpoint);
if (!routeStatusResponse.ok) {
  throw new Error(`Gateway proof route status failed: HTTP ${routeStatusResponse.status}`);
}
const routeStatus = await routeStatusResponse.json();
if (!routeStatus.enabled) {
  throw new Error(
    `Gateway proof route is disabled: ${routeStatus.disabledReason ?? 'unknown reason'}`,
  );
}

const gateway = new GatewayClient({ chain: 'arcTestnet', privateKey });
if (
  routeStatus.expectedPayer &&
  routeStatus.expectedPayer.toLowerCase() !== gateway.address.toLowerCase()
) {
  throw new Error(
    `Gateway buyer ${gateway.address} does not match configured payer ${routeStatus.expectedPayer}`,
  );
}

const depositAmount = process.env.RESVARY_GATEWAY_DEPOSIT?.trim();
const previousDepositTxHash = process.env.RESVARY_GATEWAY_DEPOSIT_TX_HASH?.trim();
const previousDepositAmount = process.env.RESVARY_GATEWAY_DEPOSIT_AMOUNT?.trim();
const deposit = depositAmount ? await gateway.deposit(depositAmount) : undefined;
const balancesBefore = await gateway.getBalances();
let capturedPayment;
gateway.onAfterPaymentCreation(async (context) => {
  capturedPayment = {
    ...context.paymentPayload,
    resource: context.paymentRequired.resource,
    accepted: context.selectedRequirements,
  };
});

const body = { proofId };
const paid = await gateway.pay(endpoint, { method: 'POST', headers: adminHeaders, body });
if (!capturedPayment) throw new Error('Circle buyer did not expose the signed payment payload');

const evidenceStore = createSqliteCreditStore({ path: dbPath });
const evidenceLedger = new CreditLedger({ projectId: 'resvary_ai_demo', store: evidenceStore });
const customerId = paid.data.fundingIntent.customerId;
const balanceBeforeReplay = await evidenceLedger.getBalance(customerId);
const grantsBeforeReplay = await evidenceLedger.store.listGrants(balanceBeforeReplay.id);
const fundingLot = (await evidenceLedger.listCreditLots(customerId)).find(
  (lot) => lot.grantId === paid.data.grant.id,
);
if (!fundingLot || fundingLot.kind !== 'general' || fundingLot.expiresAt !== undefined) {
  throw new Error('Gateway funding did not create a non-expiring general credit lot');
}

const paymentSignature = Buffer.from(JSON.stringify(capturedPayment)).toString('base64');
const replayResponse = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'payment-signature': paymentSignature,
    ...adminHeaders,
  },
  body: JSON.stringify(body),
});
const replay = await replayResponse.json();
if (!replayResponse.ok) {
  throw new Error(`Gateway replay failed: ${replay.error ?? replayResponse.statusText}`);
}
if (!replay.replayed) throw new Error('Gateway replay did not return replayed=true');
if (replay.grant?.id !== paid.data?.grant?.id) {
  throw new Error('Gateway replay returned a different credit grant');
}
if (replay.balance?.availableAmount !== paid.data?.balance?.availableAmount) {
  throw new Error('Gateway replay changed the account balance');
}
const grantsAfterReplay = await evidenceLedger.store.listGrants(balanceBeforeReplay.id);
if (grantsAfterReplay.length !== grantsBeforeReplay.length) {
  throw new Error('Gateway replay created another credit grant');
}
evidenceStore.close();

const lifecycle = await runUsageLifecycle({
  dbPath,
  projectId: 'resvary_ai_demo',
  customerId,
  proofId,
});
const balancesAfter = await gateway.getBalances();
const authorization = capturedPayment.payload?.authorization ?? {};
const transaction = paid.data.fundingTransaction;

const evidence = {
  schemaVersion: 1,
  rail: 'circle_gateway_nanopayment',
  testnetOnly: true,
  proofId,
  observedAt: new Date().toISOString(),
  endpoint,
  network: transaction.network,
  gatewayDomain: 26,
  sellerAddress: routeStatus.sellerAddress,
  payer: authorization.from ?? gateway.address,
  amount: transaction.amount,
  amountUnits: transaction.amountUnits,
  customerId: paid.data.fundingIntent.customerId,
  fundingIntentId: paid.data.fundingIntent.id,
  fundingTransactionId: transaction.id,
  creditGrantId: paid.data.grant.id,
  fundingLot: {
    kind: fundingLot.kind,
    expiresAt: fundingLot.expiresAt ?? null,
    originalAmount: fundingLot.originalAmount,
  },
  authorizationHash: transaction.evidence?.authorizationHash,
  nonce: authorization.nonce,
  facilitatorReference: paid.transaction,
  acceptedAt: transaction.acceptedAt,
  settledAt: transaction.settledAt,
  settlementStatus: transaction.settlementStatus,
  balanceAfterFunding: paid.data.balance.availableAmount,
  replay: {
    replayed: replay.replayed,
    sameGrant: replay.grant.id === paid.data.grant.id,
    balanceUnchanged: replay.balance.availableAmount === paid.data.balance.availableAmount,
    grantCountUnchanged: grantsAfterReplay.length === grantsBeforeReplay.length,
  },
  lifecycle,
  gatewayBalances: {
    before: {
      availableUnits: balancesBefore.gateway.available.toString(),
      available: balancesBefore.gateway.formattedAvailable,
    },
    after: {
      availableUnits: balancesAfter.gateway.available.toString(),
      available: balancesAfter.gateway.formattedAvailable,
    },
  },
  deposit: deposit
    ? {
        approvalTxHash: deposit.approvalTxHash,
        depositTxHash: deposit.depositTxHash,
        amountUnits: deposit.amount.toString(),
        amount: deposit.formattedAmount,
      }
    : previousDepositTxHash
      ? {
          depositTxHash: previousDepositTxHash,
          amount: previousDepositAmount,
          reusedExistingGatewayBalance: true,
        }
      : undefined,
  privacy: {
    privateKeyRecorded: false,
    fullPaymentSignatureRecorded: false,
  },
};

const outputPath = await writeEvidence(output, evidence);
console.log(`Gateway proof complete: ${outputPath}`);
console.log(`Funding transaction: ${transaction.id}`);
console.log(`Facilitator reference: ${paid.transaction}`);
console.log(`Replay-safe balance: ${paid.data.balance.availableAmount}`);
