# Stripe funding webhook

Stripe can fund the same closed-loop credit ledger as the bundled Arc and Circle integrations. Resvary does not process the card payment. Your server creates the Stripe payment, verifies its webhook, and grants the purchased credit amount.

This is an integration recipe, not a bundled Stripe adapter. Install and configure Stripe's official server SDK in your application.

## Persist the purchase contract

Before creating a Checkout Session or PaymentIntent, write a server-owned purchase record with:

- your internal purchase ID;
- the authenticated Resvary customer ID;
- the exact product-credit amount to grant;
- expected payment currency and amount in minor units;
- the Stripe PaymentIntent ID after creation;
- a pending or credited status.

Do not calculate the credit grant from webhook metadata, browser input, or `amount_received`. Those fields can confirm the payment, but the server-owned purchase record defines the product credits the customer bought.

## Verify and grant

[Stripe signature verification requires the unmodified request body](https://docs.stripe.com/webhooks?lang=node). The example assumes `purchases.findByPaymentIntent` returns the persisted contract and that `ledger` is a configured `CreditLedger`.

```ts
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) return new Response('Missing signature', { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      await request.text(),
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch {
    return new Response('Invalid signature', { status: 400 });
  }

  if (event.type !== 'payment_intent.succeeded') {
    return Response.json({ received: true });
  }

  const intent = event.data.object;
  const purchase = await purchases.findByPaymentIntent(intent.id);
  if (!purchase) return new Response('Unknown purchase', { status: 409 });
  if (
    intent.currency !== purchase.currency ||
    intent.amount_received !== purchase.paymentAmountMinor
  ) {
    return new Response('Payment does not match purchase', { status: 409 });
  }

  await ledger.grantCredits({
    customerId: purchase.customerId,
    amount: purchase.creditAmount,
    source: 'stripe',
    externalRef: intent.id,
    idempotencyKey: `stripe-payment-intent:${intent.id}`,
    metadata: { purchaseId: purchase.id },
  });
  await purchases.markCredited(purchase.id);

  return Response.json({ received: true });
}
```

The stable PaymentIntent-based idempotency key prevents a webhook retry from granting twice. If the ledger commit succeeds but `markCredited` fails, the next delivery replays the original grant and can finish the local update.

## Operational rules

- Subscribe only to events the endpoint handles. A successful Checkout Session should resolve to the persisted PaymentIntent rather than create a second grant path.
- Return a non-2xx response for a verified event that cannot be reconciled. Alert on repeated failures.
- Keep the webhook secret and Stripe secret key server-side.
- Test duplicate delivery and a crash between `grantCredits` and `markCredited`.
- Handle refunds and disputes through an explicit policy. Do not automatically subtract credits if doing so would take the available balance below zero or below an open reservation.
- Store Stripe IDs in your purchase table. Resvary's `externalRef` is evidence attached to the grant, not a replacement for payment records.

See [credit security model](credit-security-model.md) for the trust boundary and [funding recovery](funding-recovery.md) for reconciliation rules.
