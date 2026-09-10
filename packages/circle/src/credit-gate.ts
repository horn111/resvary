import {
  CreditLedger,
  InsufficientCreditsError,
  creditUnitsToString,
  type ReserveCreditsInput,
  type CreditReservation,
} from '@resvary/sdk/credits';
import { GatewayNanopaymentFunding, type GatewayFundingRequest } from './nanopayments.js';

export type GatewayCreditGateResult =
  | { status: 'reserved'; reservation: CreditReservation }
  | { status: 'payment_required'; request: GatewayFundingRequest };

/** Call with authenticated customer/payer context, after application-level job deduplication.
 * Persist a returned challenge. Reuse it on retries instead of creating another authorization.
 * Payment only buys credits; call the gate again before executing the operation.
 */
export function createGatewayCreditGate(config: {
  ledger: CreditLedger;
  funding: GatewayNanopaymentFunding;
}) {
  return async (
    input: ReserveCreditsInput & {
      expectedPayer: `0x${string}`;
      fundingIdempotencyKey: string;
    },
  ): Promise<GatewayCreditGateResult> => {
    const { expectedPayer, fundingIdempotencyKey, ...reservationInput } = input;
    if (!/^0x[0-9a-fA-F]{40}$/.test(expectedPayer)) throw new Error('Invalid expected payer');
    if (!fundingIdempotencyKey.trim()) throw new Error('Funding idempotency key required');
    try {
      return {
        status: 'reserved',
        reservation: await config.ledger.reserveCredits(reservationInput),
      };
    } catch (error) {
      if (!(error instanceof InsufficientCreditsError)) throw error;
      const missing = BigInt(error.requiredUnits) - BigInt(error.availableUnits);
      const rounded = ((missing + 9_999n) / 10_000n) * 10_000n;
      return {
        status: 'payment_required',
        request: await config.funding.createFundingRequest({
          customerId: input.customerId,
          amount: creditUnitsToString(rounded),
          expectedPayer,
          idempotencyKey: fundingIdempotencyKey,
        }),
      };
    }
  };
}
