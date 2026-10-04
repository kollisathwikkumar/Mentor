import { createPublicClient, createWalletClient, defineChain, http, isAddress, type Address, type Hex, type Chain, type HttpTransport, type LocalAccount, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { MandateSnapshot } from '@mandate/policy';

export interface MandatePort {
  getMandate(mandateId: string): Promise<MandateSnapshot>;
  executeTransfer(mandate: MandateSnapshot, amount: bigint): Promise<{ readonly transactionHash: string }>;
}

export interface TransferReceipt { readonly transactionHash: string }
import { mandateVaultAbi } from './abi.js';

export interface ViemMandateConfig {
  readonly rpcUrl: string;
  readonly chainId: number;
  readonly contractAddress: string;
  readonly agentPrivateKey: Hex;
}

const transferIntentTypes = {
  TransferIntent: [
    { name: 'mandateId', type: 'bytes32' },
    { name: 'recipient', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint64' },
  ],
} as const;

export class ViemMandatePort implements MandatePort {
  readonly #address: Address;
  readonly #publicClient: PublicClient<HttpTransport, Chain>;
  readonly #walletClient: WalletClient<HttpTransport, Chain, LocalAccount>;
  readonly #account: LocalAccount;
  readonly #chain: Chain;

  constructor(config: ViemMandateConfig) {
    if (!isAddress(config.contractAddress)) throw new TypeError('MANDATE_CONTRACT_ADDRESS must be a valid address');
    if (!/^0x[0-9a-fA-F]{64}$/.test(config.agentPrivateKey)) throw new TypeError('MANDATE_AGENT_PRIVATE_KEY must be a 32-byte hex key');
    const rpc = new URL(config.rpcUrl);
    if (rpc.protocol !== 'https:' && rpc.hostname !== 'localhost' && rpc.hostname !== '127.0.0.1') {
      throw new TypeError('RPC endpoint must use HTTPS or localhost');
    }
    if (!Number.isSafeInteger(config.chainId) || config.chainId <= 0) throw new TypeError('MONAD_CHAIN_ID must be a positive integer');
    this.#address = config.contractAddress;
    this.#chain = defineChain({
      id: config.chainId,
      name: config.chainId === 10143 ? 'Monad Testnet' : `EVM chain ${config.chainId}`,
      nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
      rpcUrls: { default: { http: [config.rpcUrl] } },
    });
    this.#account = privateKeyToAccount(config.agentPrivateKey);
    this.#publicClient = createPublicClient({ chain: this.#chain, transport: http(config.rpcUrl) });
    this.#walletClient = createWalletClient({ account: this.#account, chain: this.#chain, transport: http(config.rpcUrl) });
  }

  async getMandate(mandateId: string): Promise<MandateSnapshot> {
    if (!/^0x[0-9a-fA-F]{64}$/.test(mandateId)) throw new TypeError('mandateId must be a 32-byte hex value');
    const record = await this.#publicClient.readContract({
      address: this.#address,
      abi: mandateVaultAbi,
      functionName: 'getMandate',
      args: [mandateId as Hex],
    });
    if (!isAddress(record.principal) || !isAddress(record.agentSigner) || !isAddress(record.approvedRecipient)) {
      throw new Error('Mandate contract returned malformed address fields');
    }
    return {
      id: mandateId,
      principal: record.principal,
      agentSigner: record.agentSigner,
      approvedRecipient: record.approvedRecipient,
      perCallLimit: record.perCallLimit,
      totalLimit: record.totalLimit,
      spent: record.spent,
      deposited: record.deposited,
      expiresAt: Number(record.expiresAt),
      nextNonce: record.nextNonce,
      active: record.active,
    };
  }

  async executeTransfer(mandate: MandateSnapshot, amount: bigint): Promise<TransferReceipt> {
    if (mandate.agentSigner.toLowerCase() !== this.#account.address.toLowerCase()) {
      throw new Error('Configured signer does not match the mandate agent signer');
    }
    const deadline = BigInt(Math.min(mandate.expiresAt, Math.floor(Date.now() / 1000) + 300));
    const intent = {
      mandateId: mandate.id as Hex,
      recipient: mandate.approvedRecipient as Address,
      amount,
      nonce: mandate.nextNonce,
      deadline,
    };
    const signature = await this.#walletClient.signTypedData({
      account: this.#account,
      domain: { name: 'MandateVault', version: '1', chainId: this.#chain.id, verifyingContract: this.#address },
      types: transferIntentTypes,
      primaryType: 'TransferIntent',
      message: intent,
    });
    const hash = await this.#walletClient.writeContract({
      account: this.#account,
      chain: this.#chain,
      address: this.#address,
      abi: mandateVaultAbi,
      functionName: 'executeTransfer',
      args: [intent, signature],
    });
    const receipt = await this.#publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error('Mandate execution transaction reverted');
    return { transactionHash: hash };
  }
}

export function createViemPort(env: Readonly<Record<string, string | undefined>>): ViemMandatePort {
  const rpcUrl = env.MONAD_RPC_URL;
  const contractAddress = env.MANDATE_CONTRACT_ADDRESS;
  const agentPrivateKey = env.MANDATE_AGENT_PRIVATE_KEY;
  if (rpcUrl === undefined || contractAddress === undefined || agentPrivateKey === undefined) {
    throw new Error('Set MONAD_RPC_URL, MANDATE_CONTRACT_ADDRESS, and MANDATE_AGENT_PRIVATE_KEY in the backend environment');
  }
  const chainId = Number(env.MONAD_CHAIN_ID ?? '10143');
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new TypeError('MONAD_CHAIN_ID must be a positive integer');
  return new ViemMandatePort({
    rpcUrl,
    chainId,
    contractAddress,
    agentPrivateKey: agentPrivateKey as Hex,
  });
}
