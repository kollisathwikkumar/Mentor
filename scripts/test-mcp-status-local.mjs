import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = new URL('../', import.meta.url);
const stateDir = await mkdtemp(join(tmpdir(), 'mandate-mcp-status-'));
const persistDir = join(stateDir, 'd1');
const staticDir = join(stateDir, 'public');
const token = randomBytes(32).toString('hex');
const baseUrl = 'http://127.0.0.1:8793';
const env = { ...process.env, CI: '1', NO_COLOR: '1' };
const logs = [];
let server;

function spawnCommand(args) {
  const child = spawn('npx', args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.setEncoding('utf8').on('data', (value) => logs.push(String(value)));
  child.stderr.setEncoding('utf8').on('data', (value) => logs.push(String(value)));
  return child;
}

try {
  await mkdir(staticDir);
  const migrate = spawnCommand(['wrangler', 'd1', 'migrations', 'apply', 'mandate-mcp-activity', '--local', '--persist-to', persistDir]);
  const migrationExit = await new Promise((resolve, reject) => {
    migrate.once('error', reject);
    migrate.once('exit', resolve);
  });
  assert.equal(migrationExit, 0, `Local D1 migration failed.\n${logs.join('')}`);

  server = spawnCommand(['wrangler', 'pages', 'dev', staticDir, '--ip', '127.0.0.1', '--port', '8793', '--persist-to', persistDir, '--binding', `MCP_BEARER_TOKEN=${token}`, '--binding', 'MCP_ALLOWED_ORIGINS=http://127.0.0.1:8793', '--log-level', 'error']);
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Pages local server exited (${server.exitCode}).\n${logs.join('')}`);
    try {
      const response = await fetch(`${baseUrl}/mcp/status`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) { ready = true; break; }
    } catch { /* Wait for local Pages startup. */ }
    await delay(250);
  }
  assert.ok(ready, `Pages local server did not become ready.\n${logs.join('')}`);

  const unauthenticated = await fetch(`${baseUrl}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(unauthenticated.status, 401);
  const before = await fetch(`${baseUrl}/mcp/status`).then((response) => response.json());
  assert.equal(before.connected, false);
  assert.equal(before.connected, false);

  const initialized = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', 'Mcp-Protocol-Version': '2025-03-26' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'local-status-verification', version: '1.0.0' } } }),
  });
  assert.equal(initialized.status, 200, `MCP initialize failed: ${await initialized.text()}`);
  const after = await fetch(`${baseUrl}/mcp/status`).then((response) => response.json());
  assert.equal(after.connected, true);
  assert.equal(after.connected, true);
  console.log('PASS: local D1 migration; unauthenticated MCP denial; no-client status; authenticated Streamable HTTP initialize; recent-client status persisted.');
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  if (server) {
    server.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => server.once('exit', resolve)), delay(3000)]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
  await rm(stateDir, { recursive: true, force: true });
}
