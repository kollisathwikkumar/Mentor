import { describe, expect, it } from 'vitest';
import { getSavedMandateIds, rememberMandateId } from './mandate-index.js';

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
    clear: () => { values.clear(); },
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
}

describe('locally saved Mandate IDs', () => {
  it('keeps IDs separated by account and normalizes the account key', () => {
    const storage = createStorage();
    const owner = '0xAa00000000000000000000000000000000000001';
    const first = `0x${'a'.repeat(64)}` as const;
    const second = `0x${'b'.repeat(64)}` as const;
    rememberMandateId(storage, owner, first);
    rememberMandateId(storage, owner.toLowerCase(), second);

    expect(getSavedMandateIds(storage, owner)).toEqual([first, second]);
    expect(getSavedMandateIds(storage, '0xbb00000000000000000000000000000000000002')).toEqual([]);
  });

  it('deduplicates IDs and ignores corrupt stored data', () => {
    const storage = createStorage();
    const owner = '0xAa00000000000000000000000000000000000001';
    const id = `0x${'a'.repeat(64)}` as const;
    rememberMandateId(storage, owner, id);
    rememberMandateId(storage, owner, id);
    expect(getSavedMandateIds(storage, owner)).toEqual([id]);
    storage.setItem('mandate:ids:10143:0xaa00000000000000000000000000000000000001', '{bad');
    expect(getSavedMandateIds(storage, owner)).toEqual([]);
  });

  it('rejects malformed owners and mandate IDs', () => {
    const storage = createStorage();
    expect(() => rememberMandateId(storage, 'not-an-address', `0x${'a'.repeat(64)}`)).toThrow('address');
    expect(() => rememberMandateId(storage, '0xAa00000000000000000000000000000000000001', '0x12')).toThrow('ID');
  });
});
