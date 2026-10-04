import assert from 'node:assert/strict';
import { chmod, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPublicClient, createWalletClient, defineChain, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getTestnetDeploymentConfig } from './deployment-config.mjs';

const config = getTestnetDeploymentConfig(process.env);
const root = process.cwd();
const envFile = resolve(root, '.env.local');
const artifactFile = resolve(root, 'out/MandateVault.sol/MandateVault.json');
const originalEnv = await readFile(envFile, 'utf8');
const preflightTempFile = `${envFile}.${process.pid}.preflight`;
await writeFile(preflightTempFile, originalEnv, { mode: 0o600 });
await unlink(preflightTempFile);
const chain = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
});
const transport = http(config.rpcUrl, { timeout: 20_000 });
const publicClient = createPublicClient({ chain, transport });
const account = privateKeyToAccount(config.deployerPrivateKey);
const walletClient = createWalletClient({ account, chain, transport });

assert.equal(await publicClient.getChainId(), 10143, 'Configured RPC is not Monad Testnet');
const balance = await publicClient.getBalance({ address: account.address });
assert.ok(balance > 0n, `Fund the test deployer ${account.address} with Monad Testnet MON before deployment`);

const artifact = JSON.parse(await readFile(artifactFile, 'utf8'));
const hash = await walletClient.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object });
const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
assert.equal(receipt.status, 'success', 'MandateVault deployment transaction reverted');
assert.ok(receipt.contractAddress, 'Deployment receipt omitted the contract address');
const code = await publicClient.getCode({ address: receipt.contractAddress });
assert.ok(code !== undefined && code !== '0x', 'Deployed contract bytecode was not found at the receipt address');

const addressLine = `MANDATE_CONTRACT_ADDRESS=${receipt.contractAddress}`;
const updatedEnv = /^MANDATE_CONTRACT_ADDRESS=.*$/m.test(originalEnv)
  ? originalEnv.replace(/^MANDATE_CONTRACT_ADDRESS=.*$/m, addressLine)
  : `${originalEnv.trimEnd()}\n${addressLine}\n`;
const tempFile = `${envFile}.tmp`;
await writeFile(tempFile, updatedEnv, { mode: 0o600 });
await rename(tempFile, envFile);
await chmod(envFile, 0o600);

process.stdout.write(`Monad Testnet deployment verified.\nchainId=${config.chainId}\ncontract=${receipt.contractAddress}\ntransaction=${hash}\ncodeBytes=${(code.length - 2) / 2}\nUpdated .env.local with contract address.\n`);
