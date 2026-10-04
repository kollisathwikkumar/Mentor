import { describe, expect, it, vi } from 'vitest';
import { MandateGateway, type MandatePort } from '../src/gateway.js';
import type { MandateSnapshot } from '@mandate/policy';

const snapshot: MandateSnapshot = {
  id: `0x${'a'.repeat(64)}`,
  principal: '0x0000000000000000000000000000000000000001',
  agentSigner: '0x0000000000000000000000000000000000000002',
  approvedRecipient: '0x0000000000000000000000000000000000000003',
  perCallLimit: 4_000_000_000_000_000_000n,
  totalLimit: 10_000_000_000_000_000_000n,
  spent: 0n,
  deposited: 5_000_000_000_000_000_000n,
  expiresAt: 2_000_000_000,
  nextNonce: 0n,
  active: true,
};

function createPort(): MandatePort {
  return {
    getMandate: vi.fn(async () => snapshot),
    getNativeBalance: vi.fn(async () => 1_250_000_000_000_000_000n),
    executeTransfer: vi.fn(async () => ({ transactionHash: `0x${'b'.repeat(64)}` })),
  };
}

describe('MCP gateway', () => {
  it('denies a bad policy before it reaches the signer/executor', async () => {
    const port = createPort();
    const gateway = new MandateGateway(port, () => 1_900_000_000);
    await expect(gateway.requestTransfer({ mandateId: snapshot.id, amount: '5' })).resolves.toEqual({
      status: 'denied', reason: 'PER_CALL_LIMIT',
    });
    expect(port.executeTransfer).not.toHaveBeenCalled();
  });

  it('executes one transfer after an onchain-state pre-check', async () => {
    const port = createPort();
    const gateway = new MandateGateway(port, () => 1_900_000_000);
    await expect(gateway.requestTransfer({ mandateId: snapshot.id, amount: '3.25' })).resolves.toEqual({
      status: 'submitted', transactionHash: `0x${'b'.repeat(64)}`,
    });
    expect(port.executeTransfer).toHaveBeenCalledWith(snapshot, 3_250_000_000_000_000_000n);
  });

  it('returns status based on live mandate state', async () => {
    const port = createPort();
    const gateway = new MandateGateway(port, () => 1_900_000_000);
    await expect(gateway.getStatus(snapshot.id)).resolves.toEqual({
      mandateId: snapshot.id, principal: snapshot.principal, active: true, expired: false, recipient: snapshot.approvedRecipient,
      perCallLimit: snapshot.perCallLimit.toString(), totalLimit: snapshot.totalLimit.toString(),
      spent: '0', remaining: snapshot.totalLimit.toString(), deposited: snapshot.deposited.toString(),
      nextNonce: '0', expiresAt: snapshot.expiresAt,
    });
  });

  it('returns the native balance for the authenticated EVM principal without converting through floating point', async () => {
    const owner = snapshot.principal;
    const port = createPort();
    const gateway = new MandateGateway(port);
    await expect(gateway.getNativeBalance(owner)).resolves.toEqual({
      address: owner,
      balanceWei: '1250000000000000000',
      balanceMon: '1.25',
    });
    expect(port.getNativeBalance).toHaveBeenCalledWith(owner);
  });

  it('rejects invalid owners before making an RPC balance request', async () => {
    const port = createPort();
    const checkedGateway = new MandateGateway(port);
    await expect(checkedGateway.getNativeBalance('not-an-address')).rejects.toThrow('principal must be a valid EVM address');
    expect(port.getNativeBalance).not.toHaveBeenCalled();
  });
});

it('reports expired state and clamps remaining allowance at zero', async () => {
  const port = createPort();
  port.getMandate = vi.fn(async () => ({ ...snapshot, spent: 12_000_000_000_000_000_000n }));
  const gateway = new MandateGateway(port, () => 2_000_000_000);
  await expect(gateway.getStatus(snapshot.id)).resolves.toMatchObject({ expired: true, remaining: '0' });
});

it('does not sign or submit when the mandate read fails', async () => {
  const port = createPort();
  port.getMandate = vi.fn(async () => { throw new Error('rpc unavailable'); });
  const gateway = new MandateGateway(port, () => 1_900_000_000);
  await expect(gateway.requestTransfer({ mandateId: snapshot.id, amount: '1' })).rejects.toThrow('rpc unavailable');
  expect(port.executeTransfer).not.toHaveBeenCalled();
});

it('uses the default clock for status', async () => {
  const port = createPort();
  const gateway = new MandateGateway(port);
  await expect(gateway.getStatus(snapshot.id)).resolves.toMatchObject({ mandateId: snapshot.id, expired: false });
});
