import {
  createWalletClient,
  custom,
  getAddress,
  type Address,
  type EIP1193Provider,
  type Hex,
} from 'viem';
import { ARC_WALLET_CHAIN } from './wallet-network';

export function browserProvider() {
  const provider = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
  if (!provider)
    throw new Error('Open this page in a browser with an Ethereum-compatible wallet installed.');
  return provider;
}

export async function walletClient(expected?: string) {
  const provider = browserProvider();
  const client = createWalletClient({ chain: ARC_WALLET_CHAIN, transport: custom(provider) });
  const [account] = await client.requestAddresses();
  if (!account || (expected && account.toLowerCase() !== expected.toLowerCase()))
    throw new Error('The selected wallet changed. Connect it again before continuing.');
  try {
    await client.switchChain({ id: ARC_WALLET_CHAIN.id });
  } catch (error) {
    const code =
      (error as { code?: number; cause?: { code?: number } }).cause?.code ??
      (error as { code?: number }).code;
    if (code !== 4902) throw error;
    await client.addChain({ chain: ARC_WALLET_CHAIN });
    await client.switchChain({ id: ARC_WALLET_CHAIN.id });
  }
  if ((await client.getChainId()) !== ARC_WALLET_CHAIN.id)
    throw new Error('Select Arc Mainnet in your wallet.');
  return { client, account: getAddress(account) };
}

export async function signWallet(message: string, address: string) {
  const { client, account } = await walletClient(address);
  return client.signMessage({ account, message });
}

export async function sendTopUp(address: string, to: Address, data: Hex) {
  const { client, account } = await walletClient(address);
  return client.sendTransaction({ account, to, data, value: 0n });
}
