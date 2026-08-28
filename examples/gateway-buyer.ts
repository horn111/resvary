import { GatewayClient } from '@circle-fin/x402-batching/client';

const endpoint = process.argv[2];
const privateKey = process.env.RESVARY_GATEWAY_BUYER_PRIVATE_KEY as `0x${string}` | undefined;

if (!endpoint || !privateKey) {
  throw new Error(
    'Usage: RESVARY_GATEWAY_BUYER_PRIVATE_KEY=0x... npx tsx examples/gateway-buyer.ts https://your-app.example/api/top-up',
  );
}

const gateway = new GatewayClient({
  chain: 'arcTestnet',
  privateKey,
});
const demoAdminToken = process.env.RESVARY_DEMO_ADMIN_TOKEN?.trim();

const depositAmount = process.env.RESVARY_GATEWAY_DEPOSIT;
if (depositAmount) {
  const deposit = await gateway.deposit(depositAmount);
  console.log('Gateway deposit:', deposit);
}

const result = await gateway.pay(endpoint, {
  method: 'POST',
  headers: demoAdminToken ? { authorization: `Bearer ${demoAdminToken}` } : undefined,
});
console.log('Top-up result:', result.data);
console.log('Gateway settlement:', result.transaction);
