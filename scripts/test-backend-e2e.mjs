import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createPublicClient, createWalletClient, defineChain, http, parseEther, parseEventLogs } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rpcUrl = 'http://127.0.0.1:8545';
const localChain = defineChain({ id: 31337, name: 'Anvil Test', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
const anvil = spawn(resolve(root, 'node_modules/.bin/anvil'), ['--silent', '--host', '127.0.0.1', '--port', '8545'], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
let client;

try {
  const publicClient = createPublicClient({ chain: localChain, transport: http(rpcUrl) });
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { await publicClient.getChainId(); ready = true; break; } catch { await delay(100); }
  }
  assert.equal(ready, true, 'Anvil did not start');
  const principalPrivateKey = generatePrivateKey();
  const agentPrivateKey = generatePrivateKey();
  const principal = privateKeyToAccount(principalPrivateKey);
  const agent = privateKeyToAccount(agentPrivateKey);
  const recipient = privateKeyToAccount(generatePrivateKey());
  for (const account of [principal, agent]) {
    const funded = await publicClient.request({ method: 'anvil_setBalance', params: [account.address, '0x3635c9adc5dea00000'] });
    assert.equal(funded, null);
  }
  const principalWallet = createWalletClient({ account: principal, chain: localChain, transport: http(rpcUrl) });
  const artifactPath = resolve(root, 'out/MandateVault.sol/MandateVault.json');
  const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
  const deployHash = await principalWallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [] });
  const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
  assert.equal(deployReceipt.status, 'success');
  const contractAddress = deployReceipt.contractAddress;
  assert.ok(contractAddress);
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const salt = `0x${'4'.repeat(64)}`;
  const createHash = await principalWallet.writeContract({
    address: contractAddress, abi: artifact.abi, functionName: 'createMandate',
    args: [agent.address, recipient.address, parseEther('4'), parseEther('10'), expiry, `0x${'0'.repeat(64)}`, salt],
  });
  const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
  const [created] = parseEventLogs({ abi: artifact.abi, eventName: 'MandateCreated', logs: createReceipt.logs });
  assert.ok(created);
  const mandateId = created.args.mandateId;
  const fundHash = await principalWallet.writeContract({ address: contractAddress, abi: artifact.abi, functionName: 'fundMandate', args: [mandateId], value: parseEther('5') });
  await publicClient.waitForTransactionReceipt({ hash: fundHash });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(root, 'packages/mcp-server/dist/main.js')],
    env: {
      ...process.env,
      MONAD_RPC_URL: rpcUrl,
      MONAD_CHAIN_ID: '31337',
      MANDATE_CONTRACT_ADDRESS: contractAddress,
      MANDATE_AGENT_PRIVATE_KEY: agentPrivateKey,
    },
  });
  client = new Client({ name: 'mandate-local-e2e', version: '0.1.0' }, { capabilities: {} });
  await client.connect(transport);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), ['get_mandate_status', 'request_bounded_transfer']);

  const before = await publicClient.getBalance({ address: recipient.address });
  const allowed = await client.callTool({ name: 'request_bounded_transfer', arguments: { mandateId, amount: '3' } });
  const allowedPayload = JSON.parse(allowed.content[0].text);
  assert.equal(allowedPayload.status, 'submitted');
  const afterAllowed = await publicClient.getBalance({ address: recipient.address });
  assert.equal(afterAllowed - before, parseEther('3'));

  const denied = await client.callTool({ name: 'request_bounded_transfer', arguments: { mandateId, amount: '5' } });
  const deniedPayload = JSON.parse(denied.content[0].text);
  assert.deepEqual(deniedPayload, { status: 'denied', reason: 'PER_CALL_LIMIT' });
  assert.equal(await publicClient.getBalance({ address: recipient.address }), afterAllowed);

  const revokeHash = await principalWallet.writeContract({ address: contractAddress, abi: artifact.abi, functionName: 'revokeMandate', args: [mandateId] });
  await publicClient.waitForTransactionReceipt({ hash: revokeHash });
  const afterRevoke = await client.callTool({ name: 'request_bounded_transfer', arguments: { mandateId, amount: '1' } });
  assert.deepEqual(JSON.parse(afterRevoke.content[0].text), { status: 'denied', reason: 'MANDATE_INACTIVE' });
  assert.equal(await publicClient.getBalance({ address: recipient.address }), afterAllowed);
  process.stdout.write('Local E2E passed: MCP allowed transfer moved exact value; over-limit and revoked requests moved 0 value.\n');
} finally {
  if (client) await client.close().catch(() => undefined);
  anvil.kill('SIGTERM');
}
