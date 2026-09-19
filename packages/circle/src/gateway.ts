import {
  CIRCLE_BATCHING_NAME,
  CIRCLE_BATCHING_SCHEME,
  CIRCLE_BATCHING_VERSION,
  GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS,
} from '@circle-fin/x402-batching';

export interface ArcGatewayNetworkConfig {
  readonly name: 'arc' | 'arcTestnet';
  readonly network: 'eip155:5042' | 'eip155:5042002';
  readonly chainId: 5_042 | 5_042_002;
  readonly gatewayDomain: 26;
  readonly rpcUrl: string;
  readonly facilitatorUrl: string;
  readonly usdcAddress: `0x${string}`;
  readonly gatewayWallet: `0x${string}`;
  readonly gatewayMinter: `0x${string}`;
  readonly scheme: string;
  readonly requirementName: string;
  readonly requirementVersion: string;
  readonly authorizationValiditySeconds: number;
}

/** Arc Mainnet configuration from the official Arc and Circle references. */
export const ARC_GATEWAY_MAINNET = {
  name: 'arc',
  network: 'eip155:5042',
  chainId: 5_042,
  gatewayDomain: 26,
  rpcUrl: 'https://rpc.mainnet.arc.io',
  facilitatorUrl: 'https://gateway-api.circle.com',
  usdcAddress: '0x3600000000000000000000000000000000000000',
  gatewayWallet: '0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE',
  gatewayMinter: '0x2222222d7164433c4C09B0b0D809a9b52C04C205',
  scheme: CIRCLE_BATCHING_SCHEME,
  requirementName: CIRCLE_BATCHING_NAME,
  requirementVersion: CIRCLE_BATCHING_VERSION,
  authorizationValiditySeconds: GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS,
} as const satisfies ArcGatewayNetworkConfig;

/** Arc Testnet configuration retained for development and regression tests. */
export const ARC_GATEWAY_TESTNET = {
  name: 'arcTestnet',
  network: 'eip155:5042002',
  chainId: 5_042_002,
  gatewayDomain: 26,
  rpcUrl: 'https://rpc.testnet.arc.io',
  facilitatorUrl: 'https://gateway-api-testnet.circle.com',
  usdcAddress: '0x3600000000000000000000000000000000000000',
  gatewayWallet: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
  gatewayMinter: '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B',
  scheme: CIRCLE_BATCHING_SCHEME,
  requirementName: CIRCLE_BATCHING_NAME,
  requirementVersion: CIRCLE_BATCHING_VERSION,
  authorizationValiditySeconds: GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS,
} as const satisfies ArcGatewayNetworkConfig;

export function arcGatewayNetwork(environment: 'mainnet' | 'testnet'): ArcGatewayNetworkConfig {
  return environment === 'mainnet' ? ARC_GATEWAY_MAINNET : ARC_GATEWAY_TESTNET;
}

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
  network: ArcGatewayNetworkConfig = ARC_GATEWAY_TESTNET,
): GatewaySupportedKind & { extra: Record<string, unknown> & { verifyingContract: string } } {
  const kind = supported.kinds.find(
    (candidate) =>
      candidate.x402Version === 2 &&
      candidate.scheme === network.scheme &&
      candidate.network === network.network &&
      typeof candidate.extra?.verifyingContract === 'string' &&
      candidate.extra.verifyingContract.toLowerCase() === network.gatewayWallet.toLowerCase(),
  );
  if (!kind) {
    throw new Error(
      `Circle Gateway facilitator does not advertise ${network.name} batching support`,
    );
  }
  return kind as GatewaySupportedKind & {
    extra: Record<string, unknown> & { verifyingContract: string };
  };
}
