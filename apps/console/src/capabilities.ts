export interface TaskCapability {
  readonly id: string;
  readonly connectorId: string;
  readonly actionId: string;
  readonly label: string;
  readonly supported: boolean;
  readonly message: string;
}

// This catalog contains only the behavior enforced by the current onchain contract.
export const registeredTaskCapabilities: readonly TaskCapability[] = [
  {
    id: 'monad.native-transfer',
    connectorId: 'monad',
    actionId: 'native_transfer',
    label: 'Monad · fixed-recipient native MON transfer',
    supported: true,
    message: 'The Monad contract enforces recipient, limits, expiry, replay protection, and revocation.',
  },
];
