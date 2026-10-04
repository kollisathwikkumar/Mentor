import { describe, expect, it } from 'vitest';
import { registeredTaskCapabilities } from '../src/capabilities.js';

describe('workspace action catalog', () => {
  it('shows only the capability that the current contract actually enforces', () => {
    expect(registeredTaskCapabilities).toEqual([
      expect.objectContaining({ id: 'monad.native-transfer', connectorId: 'monad', actionId: 'native_transfer', supported: true }),
    ]);
  });
});
