import { GatewayNanopaymentFunding, createNextGatewayTopUpHandler } from '@resvary/circle';
import { getDemoCredits } from '../store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const proofIdPattern = /^[a-zA-Z0-9_-]{8,80}$/;

export async function GET() {
  const config = readLiveGatewayConfig();
  return Response.json(
    {
      enabled: config.enabled,
      disabledReason: config.disabledReason,
      network: 'eip155:5042002',
      sellerAddress: config.sellerAddress,
      expectedPayer: config.expectedPayer,
      amount: config.amount,
      customerId: config.customerId,
      persistence: process.env.RESVARY_CREDITS_DB_PATH ?? '.resvary/demo.sqlite',
      testnetOnly: true,
    },
    { headers: { 'cache-control': 'private, no-store' } },
  );
}

export async function POST(request: Request) {
  const config = readLiveGatewayConfig();
  if (!config.enabled || !config.sellerAddress) {
    return disabledResponse(
      config.disabledReason ?? 'Circle Gateway Testnet top-up is disabled for this deployment',
    );
  }

  const { ledger } = await getDemoCredits();
  const funding = new GatewayNanopaymentFunding({
    ledger,
    sellerAddress: config.sellerAddress,
    resourceUrl: request.url,
  });
  const handler = createNextGatewayTopUpHandler({
    funding,
    enabled: config.enabled,
    disabledMessage: config.disabledReason,
    resolveRequest: async (unpaidRequest) => {
      const body = await readProofBody(unpaidRequest);
      return {
        customerId: `${config.customerId}_${body.proofId}`,
        amount: config.amount,
        expectedPayer: config.expectedPayer,
        idempotencyKey: `gateway-live:${body.proofId}`,
        metadata: {
          mode: 'live_gateway_nanopayment_testnet',
          proofId: body.proofId,
        },
      };
    },
  });
  return handler(request);
}

interface LiveGatewayConfig {
  enabled: boolean;
  disabledReason?: string;
  sellerAddress?: `0x${string}`;
  expectedPayer?: `0x${string}`;
  amount: string;
  customerId: string;
}

function readLiveGatewayConfig(): LiveGatewayConfig {
  const requested = process.env.RESVARY_ENABLE_LIVE_GATEWAY === 'true';
  const sellerAddress = parseAddress(
    process.env.RESVARY_GATEWAY_SELLER_ADDRESS ?? process.env.RESVARY_TESTNET_SELLER_ADDRESS,
  );
  const expectedPayer = parseAddress(
    process.env.RESVARY_GATEWAY_EXPECTED_PAYER ?? process.env.RESVARY_TESTNET_BUYER_ADDRESS,
  );
  const allowEphemeralVercel = process.env.RESVARY_ALLOW_EPHEMERAL_GATEWAY_PROOF === 'true';
  const runningOnVercel = process.env.VERCEL === '1';

  let disabledReason: string | undefined;
  if (!requested)
    disabledReason = 'Set RESVARY_ENABLE_LIVE_GATEWAY=true to enable this proof route';
  else if (!sellerAddress) disabledReason = 'Set a valid RESVARY_GATEWAY_SELLER_ADDRESS';
  else if (
    (process.env.RESVARY_GATEWAY_EXPECTED_PAYER || process.env.RESVARY_TESTNET_BUYER_ADDRESS) &&
    !expectedPayer
  )
    disabledReason = 'The configured Gateway payer is not a valid EVM address';
  else if (runningOnVercel && !allowEphemeralVercel)
    disabledReason =
      'The SQLite proof route is disabled on ephemeral Vercel storage; run it locally or explicitly acknowledge the limitation';

  return {
    enabled: disabledReason === undefined,
    disabledReason,
    sellerAddress,
    expectedPayer,
    amount: process.env.RESVARY_GATEWAY_PROOF_AMOUNT?.trim() || '0.01',
    customerId: process.env.RESVARY_GATEWAY_PROOF_CUSTOMER_ID?.trim() || 'gateway_proof',
  };
}

async function readProofBody(request: Request): Promise<{ proofId: string }> {
  const body = (await request.json().catch(() => null)) as { proofId?: unknown } | null;
  if (!body || typeof body.proofId !== 'string' || !proofIdPattern.test(body.proofId)) {
    throw new Error('proofId must contain 8-80 letters, numbers, underscores, or dashes');
  }
  return { proofId: body.proofId };
}

function parseAddress(value?: string): `0x${string}` | undefined {
  const trimmed = value?.trim();
  return trimmed && addressPattern.test(trimmed) ? (trimmed as `0x${string}`) : undefined;
}

function disabledResponse(message: string): Response {
  return Response.json(
    { error: message },
    { status: 503, headers: { 'cache-control': 'private, no-store' } },
  );
}
