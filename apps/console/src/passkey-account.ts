import { createPasskeyWithPrfOutput, createSecp256k1SigningSession, getPasskeyPrfOutput, isMeraError } from '@category-labs/mera';
import { toViemAccount } from '@category-labs/mera/viem';
import { HDKey } from '@scure/bip32';
import type { LocalAccount, Address } from 'viem';

const ACCOUNT_PATH = "m/44'/60'/0'/0/0";
const CREDENTIAL_STORAGE_KEY = 'mandate.passkey-credential.v1';

export type PasskeyAccountSession = {
  address: Address;
  account: LocalAccount<'mera'>;
  end: () => void;
};

export type StoredPasskeyCredential = {
  credentialId: string;
  transports?: readonly string[];
};

export function explainPasskeyError(error: unknown): string {
  if (isMeraError(error)) {
    if (error.code === 'PRF_UNAVAILABLE') return 'This device’s passkey provider does not support Mandate sign-in yet. Try a PRF-compatible passkey provider, or use an existing EVM wallet.';
    if (error.code === 'PASSKEY_OPERATION_FAILED') return 'Passkey sign-in was canceled or unavailable. Try again, choose a different passkey, or use an existing EVM wallet.';
    if (error.code === 'CRYPTO_UNAVAILABLE') return 'This browser is missing a required secure cryptography feature. Update it or use an existing EVM wallet.';
  }
  return error instanceof Error ? error.message : 'Passkey sign-in did not complete. Try again or use an existing EVM wallet.';
}

/** Derives an EVM signing session from an authenticator PRF output. The input
 * is wiped before returning; private derivation buffers are wiped as well. */
export function derivePasskeyAccount(prfOutput: Uint8Array): PasskeyAccountSession {
  if (prfOutput.byteLength !== 32) {
    prfOutput.fill(0);
    throw new Error('This passkey did not return the 32-byte security proof Mandate needs.');
  }

  let root: HDKey | undefined;
  let child: HDKey | undefined;
  let privateKey: Uint8Array | undefined;
  try {
    root = HDKey.fromMasterSeed(prfOutput);
    child = root.derive(ACCOUNT_PATH);
    const derivedKey = child.privateKey;
    if (!derivedKey) throw new Error('The passkey could not derive an EVM account.');
    privateKey = new Uint8Array(derivedKey);
    const signingSession = createPasskeySigningSession(privateKey);
    const account = toViemAccount(signingSession);
    return { address: account.address, account, end: () => signingSession.end() };
  } finally {
    prfOutput.fill(0);
    privateKey?.fill(0);
    child?.wipePrivateData();
    root?.wipePrivateData();
  }
}

function createPasskeySigningSession(privateKey: Uint8Array) {
  return createSecp256k1SigningSession({ privateKey });
}

export async function createPasskeyAccount(): Promise<{
  session: PasskeyAccountSession;
  credential: StoredPasskeyCredential;
}> {
  const { credentialId, transports, prfOutput } = await createPasskeyWithPrfOutput({
    rp: { id: window.location.hostname, name: 'Mandate' },
    user: { name: 'Mandate account', displayName: 'Mandate account' },
  });
  const credential = { credentialId, transports };
  persistPasskeyCredential(credential);
  return { session: derivePasskeyAccount(prfOutput), credential };
}

export async function unlockPasskeyAccount(): Promise<{
  session: PasskeyAccountSession;
  credential: StoredPasskeyCredential;
}> {
  const credential = readPasskeyCredential();
  const result = await getPasskeyPrfOutput({
    rpId: window.location.hostname,
    ...(credential ? { credential } : {}),
  });
  const selectedCredential = { credentialId: result.credentialId, transports: credential?.transports };
  persistPasskeyCredential(selectedCredential);
  return { session: derivePasskeyAccount(result.prfOutput), credential: selectedCredential };
}

export function readPasskeyCredential(): StoredPasskeyCredential | undefined {
  try {
    const raw = window.localStorage.getItem(CREDENTIAL_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || !('credentialId' in parsed) ||
        typeof parsed.credentialId !== 'string' || parsed.credentialId.length === 0) return undefined;
    const transports = 'transports' in parsed && Array.isArray(parsed.transports)
      ? parsed.transports.filter((value): value is string => typeof value === 'string')
      : undefined;
    return { credentialId: parsed.credentialId, ...(transports ? { transports } : {}) };
  } catch {
    return undefined;
  }
}

export function persistPasskeyCredential(credential: StoredPasskeyCredential): void {
  window.localStorage.setItem(CREDENTIAL_STORAGE_KEY, JSON.stringify(credential));
}

export function clearPasskeyCredential(): void {
  window.localStorage.removeItem(CREDENTIAL_STORAGE_KEY);
}
