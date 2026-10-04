import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseEventLogs,
  parseEther,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mandateId = '0x36a730095a8f287f71184280d67d91c37cc3dd9bc4eebb3cf90908da8067dd4e';
const transferAmount = parseEther('0.01');
const overLimitAmount = '0.010000000000000001';
const expectedContract = '0x77065a818481ceebba93e79988bef9fd646f457d';
const expectedMandate = {
  perCallLimit: parseEther('0.01'),
  totalLimit: parseEther('0.02'),
  spent: 0n,
  deposited: parseEther('0.02'),
  nextNonce: 0n,
};

for (const name of ['MONAD_RPC_URL', 'MANDATE_CONTRACT_ADDRESS', 'MANDATE_AGENT_PRIVATE_KEY', 'MANDATE_DEPLOYER_PRIVATE_KEY']) {
  assert.ok(process.env[name], `Missing ${name} in .env.local`);
}
assert.equal(process.env.MONAD_CHAIN_ID, '10143', 'Refusing to run against a non-Monad-testnet configuration');
assert.equal(process.env.MANDATE_CONTRACT_ADDRESS?.toLowerCase(), expectedContract.toLowerCase(), 'Unexpected contract address');

const chain = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [process.env.MONAD_RPC_URL] } },
});
const publicClient = createPublicClient({ chain, transport: http(process.env.MONAD_RPC_URL, { timeout: 30_000 }) });
const principal = privateKeyToAccount(process.env.MANDATE_DEPLOYER_PRIVATE_KEY);
const agent = privateKeyToAccount(process.env.MANDATE_AGENT_PRIVATE_KEY);
const principalWallet = createWalletClient({ account: principal, chain, transport: http(process.env.MONAD_RPC_URL, { timeout: 30_000 }) });
const contractAddress = process.env.MANDATE_CONTRACT_ADDRESS;
const artifact = JSON.parse(await readFile(resolve(root, 'out/MandateVault.sol/MandateVault.json'), 'utf8'));
const abi = artifact.abi;

assert.equal(await publicClient.getChainId(), 10143, 'RPC is not Monad Testnet');
assert.notEqual(await publicClient.getCode({ address: contractAddress }), '0x', 'MandateVault bytecode is missing');

const initialRecord = await publicClient.readContract({ address: contractAddress, abi, functionName: 'getMandate', args: [mandateId] });
assert.equal(initialRecord.principal.toLowerCase(), principal.address.toLowerCase(), 'Configured principal does not own the test mandate');
assert.equal(initialRecord.agentSigner.toLowerCase(), agent.address.toLowerCase(), 'Configured agent key does not match the mandate');
assert.equal(initialRecord.approvedRecipient.toLowerCase(), agent.address.toLowerCase(), 'Test recipient differs from the preconfigured test mandate');
assert.equal(initialRecord.active, true, 'Test mandate is already inactive; refusing to send or repeat transactions');
for (const [field, expected] of Object.entries(expectedMandate)) {
  assert.equal(initialRecord[field], expected, `Unexpected initial mandate ${field}; refusing to run a non-repeatable live flow`);
}
assert.ok(Number(initialRecord.expiresAt) > Math.floor(Date.now() / 1000), 'Test mandate is expired');

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(root, 'packages/mcp-server/dist/main.js')],
  env: { ...process.env, MONAD_CHAIN_ID: '10143' },
});
const client = new Client({ name: 'mandate-testnet-acceptance', version: '0.1.0' }, { capabilities: {} });
let connected = false;

async function callTool(name, args) {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, undefined, `${name} returned an MCP error`);
  const text = result.content.find((item) => item.type === 'text')?.text;
  assert.ok(text, `${name} returned no text payload`);
  return JSON.parse(text);
}

try {
  await client.connect(transport);
  connected = true;
  const tools = await client.listTools();
  const toolNames = tools.tools.map((tool) => tool.name);
  assert.ok(toolNames.includes('request_bounded_transfer'), 'MCP server did not expose the bounded transfer tool');
  assert.ok(toolNames.includes('get_mandate_status'), 'MCP server did not expose the status tool');

  const beforeStatus = await callTool('get_mandate_status', { mandateId });
  assert.equal(beforeStatus.active, true);
  assert.equal(beforeStatus.spent, '0');
  assert.equal(beforeStatus.deposited, initialRecord.deposited.toString());
  assert.equal(beforeStatus.nextNonce, '0');

  const beforeContractBalance = await publicClient.getBalance({ address: contractAddress });
  const beforeAgentBalance = await publicClient.getBalance({ address: agent.address });
  const allowed = await callTool('request_bounded_transfer', { mandateId, amount: '0.01' });
  assert.equal(allowed.status, 'submitted');
  assert.match(allowed.transactionHash, /^0x[0-9a-fA-F]{64}$/);
  const transferReceipt = await publicClient.waitForTransactionReceipt({ hash: allowed.transactionHash });
  assert.equal(transferReceipt.status, 'success');
  const transferEvents = parseEventLogs({ abi, eventName: 'TransferExecuted', logs: transferReceipt.logs });
  assert.equal(transferEvents.length, 1);
  assert.equal(transferEvents[0].args.mandateId.toLowerCase(), mandateId.toLowerCase());
  assert.equal(transferEvents[0].args.recipient.toLowerCase(), agent.address.toLowerCase());
  assert.equal(transferEvents[0].args.amount, transferAmount);
  assert.equal(transferEvents[0].args.nonce, 0n);
  const transferGasPrice = transferReceipt.effectiveGasPrice;
  assert.ok(transferGasPrice !== undefined, 'Transfer receipt omitted effective gas price');
  const afterAgentBalance = await publicClient.getBalance({ address: agent.address });
  assert.equal(
    afterAgentBalance - beforeAgentBalance + transferReceipt.gasUsed * transferGasPrice,
    transferAmount,
    'Recipient balance delta, adjusted for the agent transaction gas, did not equal the authorized transfer',
  );
  assert.equal(beforeContractBalance - await publicClient.getBalance({ address: contractAddress }), transferAmount);

  const afterTransfer = await callTool('get_mandate_status', { mandateId });
  assert.equal(afterTransfer.spent, transferAmount.toString());
  assert.equal(afterTransfer.deposited, transferAmount.toString());
  assert.equal(afterTransfer.nextNonce, '1');

  const deniedOverLimit = await callTool('request_bounded_transfer', { mandateId, amount: overLimitAmount });
  assert.deepEqual(deniedOverLimit, { status: 'denied', reason: 'PER_CALL_LIMIT' });
  assert.deepEqual(await callTool('get_mandate_status', { mandateId }), afterTransfer, 'Denied over-limit request changed mandate state');

  const revokeHash = await principalWallet.writeContract({ address: contractAddress, abi, functionName: 'revokeMandate', args: [mandateId] });
  const revokeReceipt = await publicClient.waitForTransactionReceipt({ hash: revokeHash, timeout: 120_000 });
  assert.equal(revokeReceipt.status, 'success');
  assert.equal(parseEventLogs({ abi, eventName: 'MandateRevoked', logs: revokeReceipt.logs }).length, 1);

  const deniedAfterRevoke = await callTool('request_bounded_transfer', { mandateId, amount: '0.001' });
  assert.deepEqual(deniedAfterRevoke, { status: 'denied', reason: 'MANDATE_INACTIVE' });
  const postRevoke = await callTool('get_mandate_status', { mandateId });
  assert.equal(postRevoke.active, false);
  assert.equal(postRevoke.spent, transferAmount.toString());
  assert.equal(postRevoke.deposited, transferAmount.toString());
  assert.equal(postRevoke.nextNonce, '1');

  const principalBalanceBeforeWithdraw = await publicClient.getBalance({ address: principal.address });
  const contractBalanceBeforeWithdraw = await publicClient.getBalance({ address: contractAddress });
  const withdrawHash = await principalWallet.writeContract({ address: contractAddress, abi, functionName: 'withdrawAfterRevoke', args: [mandateId] });
  const withdrawReceipt = await publicClient.waitForTransactionReceipt({ hash: withdrawHash, timeout: 120_000 });
  assert.equal(withdrawReceipt.status, 'success');
  const withdrawals = parseEventLogs({ abi, eventName: 'FundsWithdrawn', logs: withdrawReceipt.logs });
  assert.equal(withdrawals.length, 1);
  assert.equal(withdrawals[0].args.amount, transferAmount);
  const withdrawGasPrice = withdrawReceipt.effectiveGasPrice;
  assert.ok(withdrawGasPrice !== undefined, 'Withdrawal receipt omitted effective gas price');
  assert.equal(contractBalanceBeforeWithdraw - await publicClient.getBalance({ address: contractAddress }), transferAmount);
  assert.equal(
    (await publicClient.getBalance({ address: principal.address })) - principalBalanceBeforeWithdraw + withdrawReceipt.gasUsed * withdrawGasPrice,
    transferAmount,
    'Principal withdrawal balance delta, adjusted for gas, did not equal the unspent escrow',
  );

  const finalStatus = await callTool('get_mandate_status', { mandateId });
  assert.equal(finalStatus.active, false);
  assert.equal(finalStatus.spent, transferAmount.toString());
  assert.equal(finalStatus.deposited, '0');
  assert.equal(finalStatus.nextNonce, '1');
  assert.equal(await publicClient.getBalance({ address: contractAddress }), 0n);

  process.stdout.write(JSON.stringify({
    status: 'PASS',
    chainId: 10143,
    contract: contractAddress,
    mandateId,
    tools: toolNames,
    boundedTransfer: { status: 'success', amountWei: transferAmount.toString(), transactionHash: allowed.transactionHash, eventNonce: '0' },
    overLimit: deniedOverLimit,
    revoke: { status: 'success', transactionHash: revokeHash },
    postRevoke: deniedAfterRevoke,
    withdrawal: { status: 'success', amountWei: transferAmount.toString(), transactionHash: withdrawHash },
    finalStatus,
  }, null, 2) + '\n');
} finally {
  if (connected) await client.close().catch(() => undefined);
}
