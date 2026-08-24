import {
  CIRCLE_BATCHING_NAME,
  CIRCLE_BATCHING_SCHEME,
  CIRCLE_BATCHING_VERSION,
  GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS,
} from '@circle-fin/x402-batching';

export const ARC_GATEWAY_TESTNET = {
  name: 'arcTestnet',
  network: 'eip155:5042002',
  chainId: 5_042_002,
  gatewayDomain: 26,
  rpcUrl: 'https://rpc.testnet.arc.network',
  facilitatorUrl: 'https://gateway-api-testnet.circle.com',
  usdcAddress: '0x3600000000000000000000000000000000000000',
  gatewayWallet: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
  gatewayMinter: '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B',
  scheme: CIRCLE_BATCHING_SCHEME,
  requirementName: CIRCLE_BATCHING_NAME,
  requirementVersion: CIRCLE_BATCHING_VERSION,
  authorizationValiditySeconds: GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS,
} as const;

export interface GatewaySupportedKind {
  x402Version: number;
  scheme: string;
  network: string;
  extra?: Record<string, unknown>;
}

export interface GatewaySupportedResponse {
  kinds: GatewaySupportedKind[];
  extensions: string[];
  signers: Record<string, string[]>;
}

export function requireArcGatewayKind(
  supported: GatewaySupportedResponse,
): GatewaySupportedKind & { extra: Record<string, unknown> & { verifyingContract: string } } {
  const kind = supported.kinds.find(
    (candidate) =>
      candidate.x402Version === 2 &&
      candidate.scheme === ARC_GATEWAY_TESTNET.scheme &&
      candidate.network === ARC_GATEWAY_TESTNET.network &&
      typeof candidate.extra?.verifyingContract === 'string',
  );
  if (!kind) {
    throw new Error('Circle Gateway facilitator does not advertise Arc Testnet batching support');
  }
  return kind as GatewaySupportedKind & {
    extra: Record<string, unknown> & { verifyingContract: string };
  };
}
