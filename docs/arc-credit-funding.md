# Arc Credit Funding

Arc USDC is Resvary's reference and first-class funding path for prepaid credit accounts. The internal credit ledger remains payment-rail agnostic, so usage accounting does not depend on payment transport and teams can add other funding methods without changing the reserve, commit, and release lifecycle.

```typescript
import { CreditLedger } from '@resvary/sdk/credits';
import { ArcCreditFunding } from '@resvary/sdk/funding/arc';

const funding = new ArcCreditFunding({
  ledger: credits,
  payTo: '0x1111111111111111111111111111111111111111',
});

const request = await funding.createFundingRequest({
  customerId: 'customer_123',
  amount: '25',
  idempotencyKey: 'topup_123',
});
```

The request contains a funding intent, payment invoice, and memo payment request. Use the existing watcher or proof APIs to create a verified `PaymentReceipt`, then confirm it:

```typescript
await funding.confirmPayment({
  fundingIntentId: request.fundingIntent.id,
  receipt: paymentReceipt,
  idempotencyKey: `arc:${paymentReceipt.txHash}`,
});
```

Confirmation validates invoice, network, recipient, amount, and transaction hash. Underpayments fail. Overpayments credit the verified amount. A `network + txHash` pair can fund only one account.

Payment and usage receipts remain distinct. The former proves the funding transfer; the latter explains a product charge.

The current adapter is Arc Testnet-first. Do not present it as a production custody, redemption, or mainnet money flow.
