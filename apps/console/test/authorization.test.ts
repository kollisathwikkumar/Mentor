import { describe, expect, it } from 'vitest';
import { validateAuthorizationDraft, type AuthorizationDraft } from '../src/authorization.js';

const validDraft: AuthorizationDraft = {
  task: 'Pay the approved supplier after invoice review.',
  agent: '0x0000000000000000000000000000000000000002',
  recipient: '0x0000000000000000000000000000000000000003',
  perCallMon: '0.01',
  totalMon: '0.02',
  expiresAt: '2030-01-01T12:00',
};

describe('authorization review validation', () => {
  it('accepts an explicit task and bounded supported permission', () => {
    expect(validateAuthorizationDraft(validDraft, Date.UTC(2029, 0, 1) / 1000)).toEqual({
      ok: true,
      agent: validDraft.agent,
      recipient: validDraft.recipient,
      expiresAt: BigInt(Date.parse(validDraft.expiresAt) / 1000),
      perCallWei: 10_000_000_000_000_000n,
      totalWei: 20_000_000_000_000_000n,
    });
  });

  it('requires a task description before opening the policy review', () => {
    expect(validateAuthorizationDraft({ ...validDraft, task: '   ' }, 1)).toEqual({
      ok: false,
      message: 'Describe the job this agent should handle before defining its access.',
    });
  });

  it('rejects malformed agent and recipient identities', () => {
    expect(validateAuthorizationDraft({ ...validDraft, agent: 'agent' }, 1).ok).toBe(false);
    expect(validateAuthorizationDraft({ ...validDraft, recipient: 'supplier' }, 1).ok).toBe(false);
  });

  it('rejects missing, invalid, or expired policy lifetimes', () => {
    expect(validateAuthorizationDraft({ ...validDraft, expiresAt: '' }, 1).ok).toBe(false);
    expect(validateAuthorizationDraft({ ...validDraft, expiresAt: 'not-a-date' }, 1).ok).toBe(false);
    expect(validateAuthorizationDraft({ ...validDraft, expiresAt: '2020-01-01T00:00' }, 1_700_000_000).ok).toBe(false);
  });

  it('rejects invalid or unbounded value limits', () => {
    expect(validateAuthorizationDraft({ ...validDraft, perCallMon: 'not-an-amount' }, 1).ok).toBe(false);
    expect(validateAuthorizationDraft({ ...validDraft, perCallMon: '0' }, 1).ok).toBe(false);
    expect(validateAuthorizationDraft({ ...validDraft, totalMon: '0.005' }, 1).ok).toBe(false);
  });
});
