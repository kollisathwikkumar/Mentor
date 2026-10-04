import { afterEach, describe, expect, it, vi } from 'vitest';
import { createViemPort } from '../src/index.js';

describe('ViemMandatePort owner balance reads', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads only the principal address through eth_getBalance', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x1158e460913d0000' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const port = createViemPort({
      MONAD_RPC_URL: 'https://rpc.example.invalid',
      MANDATE_CONTRACT_ADDRESS: '0x0000000000000000000000000000000000000003',
    });
    const principal = '0x0000000000000000000000000000000000000001';

    await expect(port.getNativeBalance(principal)).resolves.toBe(1_250_000_000_000_000_000n);
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      readonly method: string;
      readonly params: readonly string[];
    };
    expect(requestBody.method).toBe('eth_getBalance');
    expect(requestBody.params[0]?.toLowerCase()).toBe(principal.toLowerCase());
    expect(requestBody.params[1]).toBe('latest');
  });

  it('allows read-only RPC configuration without a signer key and rejects transfer submission', async () => {
    const port = createViemPort({
      MONAD_RPC_URL: 'https://rpc.example.invalid',
      MANDATE_CONTRACT_ADDRESS: '0x0000000000000000000000000000000000000003',
    });
    await expect(port.executeTransfer({
      id: `0x${'a'.repeat(64)}`,
      principal: '0x0000000000000000000000000000000000000001',
      agentSigner: '0x0000000000000000000000000000000000000002',
      approvedRecipient: '0x0000000000000000000000000000000000000003',
      perCallLimit: 1n, totalLimit: 1n, spent: 0n, deposited: 1n,
      expiresAt: 2_000_000_000, nextNonce: 0n, active: true,
    }, 1n)).rejects.toThrow('Transfer signing is not configured');
  });

  it('rejects malformed signer keys when configured', () => {
    expect(() => createViemPort({
      MONAD_RPC_URL: 'https://rpc.example.invalid',
      MANDATE_CONTRACT_ADDRESS: '0x0000000000000000000000000000000000000003',
      MANDATE_AGENT_PRIVATE_KEY: 'not-a-key',
    })).toThrow('MANDATE_AGENT_PRIVATE_KEY must be a 32-byte hex key');
  });
});
