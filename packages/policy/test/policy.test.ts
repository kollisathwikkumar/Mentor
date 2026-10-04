import { describe, expect, it } from 'vitest';
import { evaluateTransfer, parseMonToWei, transferRequestSchema } from '../src/index.js';

const ether = 10n ** 18n;
const baseMandate = {
  id: `0x${'1'.repeat(64)}`,
  principal: '0x0000000000000000000000000000000000000001',
  agentSigner: '0x0000000000000000000000000000000000000002',
  approvedRecipient: '0x0000000000000000000000000000000000000003',
  perCallLimit: 4n * ether,
  totalLimit: 10n * ether,
  spent: 2n * ether,
  deposited: 5n * ether,
  expiresAt: 2_000_000_000,
  nextNonce: 0n,
  active: true,
};

describe('MON amount parsing', () => {
  it('converts decimal MON to exact wei without floating point', () => {
    expect(parseMonToWei('1.000000000000000001')).toBe(ether + 1n);
    expect(parseMonToWei('0.000000000000000001')).toBe(1n);
  });
  it('rejects malformed and over-precision values', () => {
    expect(() => parseMonToWei('1e3')).toThrow();
    expect(() => parseMonToWei('0.0000000000000000001')).toThrow();
  });
});

describe('transfer decision', () => {
  it('allows one bounded transfer when all mandate conditions hold', () => {
    expect(evaluateTransfer({ mandate: baseMandate, amount: 3n * ether, now: 1_900_000_000 })).toEqual({ allowed: true, reason: 'ALLOW' });
  });
  it.each([
    [{ ...baseMandate, active: false }, 1n * ether, 1_900_000_000, 'MANDATE_INACTIVE'],
    [baseMandate, 1n * ether, 2_000_000_000, 'MANDATE_EXPIRED'],
    [baseMandate, 0n, 1_900_000_000, 'INVALID_AMOUNT'],
    [baseMandate, 5n * ether, 1_900_000_000, 'PER_CALL_LIMIT'],
    [{ ...baseMandate, spent: 8n * ether }, 3n * ether, 1_900_000_000, 'TOTAL_LIMIT'],
    [{ ...baseMandate, perCallLimit: 7n * ether }, 6n * ether, 1_900_000_000, 'INSUFFICIENT_DEPOSIT'],
  ] as const)('denies on %s', (mandate, amount, now, reason) => {
    expect(evaluateTransfer({ mandate, amount, now })).toEqual({ allowed: false, reason });
  });
});

describe('MCP transfer request schema', () => {
  it('accepts only mandate id and positive decimal amount', () => {
    expect(transferRequestSchema.safeParse({ mandateId: `0x${'a'.repeat(64)}`, amount: '1.25' }).success).toBe(true);
  });
  it('rejects recipient overrides and other unexpected fields', () => {
    expect(transferRequestSchema.safeParse({ mandateId: `0x${'a'.repeat(64)}`, amount: '1.25', recipient: '0x0000000000000000000000000000000000000009' }).success).toBe(false);
  });
});
