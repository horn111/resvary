import {
  GatewayNanopaymentFunding,
  ARC_GATEWAY_TESTNET,
  type GatewayFacilitator,
} from '@resvary/circle';
import type { Runtime } from './runtime';

export function funding(rt: Runtime, id: string) {
  const facilitator: GatewayFacilitator | undefined = rt.cfg.testMode
    ? {
        async getSupported() {
          return {
            kinds: [
              {
                x402Version: 2,
                scheme: 'exact',
                network: ARC_GATEWAY_TESTNET.network,
                extra: { verifyingContract: ARC_GATEWAY_TESTNET.gatewayWallet },
              },
            ],
            extensions: [],
            signers: {},
          };
        },
        async verify() {
          return { isValid: true, payer: rt.cfg.payer };
        },
        async settle(payload, requirements) {
          return {
            success: true,
            payer: rt.cfg.payer,
            transaction: `TEST_FIXTURE_${payload.payload.authorization?.nonce}`,
            network: ARC_GATEWAY_TESTNET.network,
            amount: requirements.amount,
          };
        },
      }
    : undefined;
  return new GatewayNanopaymentFunding({
    ledger: rt.ledger,
    sellerAddress: rt.cfg.seller,
    facilitator,
    // Circle CLI 1.0.0 raises batched payment requirements to at least 30 days.
    // Advertise the same window so strict accepted-requirements validation holds.
    authorizationValiditySeconds: 30 * 24 * 60 * 60,
    resourceUrl: `${rt.cfg.origin}/api/internal/topup/${id}`,
  });
}
