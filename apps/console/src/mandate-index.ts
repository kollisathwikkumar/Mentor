import type { Hex } from 'viem';

const ownerPattern = /^0x[0-9a-fA-F]{40}$/;
const mandateIdPattern = /^0x[0-9a-fA-F]{64}$/;

function storageKey(owner: string): string {
  if (!ownerPattern.test(owner)) throw new TypeError('owner must be a valid EVM address');
  return `mandate:ids:10143:${owner.toLowerCase()}`;
}

export function getSavedMandateIds(storage: Pick<Storage, 'getItem'>, owner: string): readonly Hex[] {
  let raw: string | null;
  try { raw = storage.getItem(storageKey(owner)); }
  catch { return []; }
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((item): item is Hex => typeof item === 'string' && mandateIdPattern.test(item)))];
  } catch { return []; }
}

export function rememberMandateId(storage: Pick<Storage, 'getItem' | 'setItem'>, owner: string, mandateId: string): void {
  const key = storageKey(owner);
  if (!mandateIdPattern.test(mandateId)) throw new TypeError('mandate ID must be a 32-byte hex value');
  const current = getSavedMandateIds(storage, owner);
  if (current.some((value) => value.toLowerCase() === mandateId.toLowerCase())) return;
  try { storage.setItem(key, JSON.stringify([...current, mandateId])); }
  catch { /* local persistence is a convenience; chain authorization must not depend on storage. */ }
}
