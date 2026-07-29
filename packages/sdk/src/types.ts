/**
 * Core type definitions for Settlary.
 */

/** Supported x402 protocol versions */
export type X402Version = 1 | 2;

/** Supported payment schemes */
export type PaymentScheme = 'exact' | 'upto';

/** Network configuration for Arc or other EVM chains */
export interface NetworkConfig {
  /** Chain ID (e.g., 5042002 for Arc Testnet) */
  readonly chainId: number;
  /** RPC endpoint URL */
  readonly rpcUrl: string;
  /** Human-readable network name */
  readonly name: string;
  /** USDC contract address on this network */
  readonly usdcAddress: `0x${string}`;
  /** Block explorer URL */
  readonly explorerUrl: string;
  /** CCTP Domain ID for cross-chain operations */
  readonly cctpDomainId?: number;
}

/** Payment requirements returned in 402 response */
export interface PaymentRequirements {
  /** x402 protocol version */
  x402Version: X402Version;
  /** Payment scheme type */
  scheme: PaymentScheme;
  /** Target network identifier */
  network: string;
  /** Payment amount in USDC (human-readable, e.g., "0.001") */
  maxAmountRequired: string;
  /** Seller's payment receiving address */
  payTo: `0x${string}`;
  /** Human-readable description of what's being purchased */
  description?: string;
  /** Additional resource metadata */
  resource?: string;
  /** MIME type of the resource */
  mimeType?: string;
  /** Expiration timestamp (Unix seconds) */
  expiry?: number;
}

/** Payment payload sent in X-PAYMENT header */
export interface PaymentPayload {
  /** x402 protocol version */
  x402Version: X402Version;
  /** Payment scheme */
  scheme: PaymentScheme;
  /** Target network */
  network: string;
  /** Signed payment authorization */
  payload: {
    /** EIP-3009 transferWithAuthorization signature */
    signature: `0x${string}`;
    /** Authorization details */
    authorization: {
      /** Buyer's address */
      from: `0x${string}`;
      /** Seller's address */
      to: `0x${string}`;
      /** Payment amount in smallest unit (6 decimals for USDC) */
      value: string;
      /** Authorization valid-after timestamp */
      validAfter: string;
      /** Authorization valid-before timestamp */
      validBefore: string;
      /** Unique nonce to prevent replay */
      nonce: `0x${string}`;
    };
  };
}

/** Result of a payment verification */
export interface PaymentResult {
  /** Whether payment was successfully verified */
  success: boolean;
  /** Transaction hash if settled on-chain */
  transactionHash?: `0x${string}`;
  /** Settlement status */
  settlementStatus: 'pending' | 'batched' | 'settled' | 'failed';
  /** Amount paid in USDC */
  amount: string;
  /** Buyer's address */
  from: `0x${string}`;
  /** Timestamp of payment */
  timestamp: number;
}

/** Configuration for a paywalled endpoint */
export interface EndpointConfig {
  /** Price in USDC per unit (depends on pricing model) */
  price: string;
  /** Network identifier (default: 'arc-testnet') */
  network?: string;
  /** Human-readable endpoint description */
  description?: string;
  /** Payment scheme (default: 'exact') */
  scheme?: PaymentScheme;
  /** Custom payment verification function */
  verifyPayment?: (payload: PaymentPayload) => Promise<PaymentResult>;
}
