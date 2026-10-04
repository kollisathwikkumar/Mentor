import { describe, expect, it } from 'vitest';
import { MeraError } from '@category-labs/mera';
import { recoverMessageAddress } from 'viem';
import { derivePasskeyAccount, explainPasskeyError } from './passkey-account.js';

describe('passkey-derived Mandate account', () => {
  it('derives a stable account, signs messages for OAuth, and clears session key material', async () => {
    const firstPrf = new Uint8Array(32).fill(7);
    const secondPrf = new Uint8Array(32).fill(7);
    const first = derivePasskeyAccount(firstPrf);
    const second = derivePasskeyAccount(secondPrf);
    const message = 'Connect test client to Mandate';
    const signature = await first.account.signMessage({ message });

    expect(first.address).toBe(second.address);
    expect(await recoverMessageAddress({ message, signature })).toBe(first.address);
    expect([...firstPrf].every((byte) => byte === 0)).toBe(true);
    expect([...secondPrf].every((byte) => byte === 0)).toBe(true);

    first.end();
    await expect(first.account.signMessage({ message })).rejects.toThrow();
    second.end();
  });

  it('derives separate addresses from separate passkey PRF outputs', () => {
    const first = derivePasskeyAccount(new Uint8Array(32).fill(1));
    const second = derivePasskeyAccount(new Uint8Array(32).fill(2));

    expect(first.address).not.toBe(second.address);

    first.end();
    second.end();
  });

  it('turns unsupported PRF errors into a user-readable fallback', () => {
    expect(explainPasskeyError(new MeraError('PRF_UNAVAILABLE', 'no PRF')))
      .toContain('does not support Mandate sign-in yet');
    expect(explainPasskeyError(new MeraError('PASSKEY_OPERATION_FAILED', 'cancelled')))
      .toContain('was canceled or unavailable');
  });
});
