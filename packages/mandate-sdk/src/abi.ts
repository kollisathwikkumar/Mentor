export const mandateVaultAbi = [
  { type: 'function', name: 'createMandate', stateMutability: 'nonpayable', inputs: [
    { name: 'agentSigner', type: 'address' }, { name: 'approvedRecipient', type: 'address' },
    { name: 'perCallLimit', type: 'uint256' }, { name: 'totalLimit', type: 'uint256' },
    { name: 'expiresAt', type: 'uint64' }, { name: 'policyHash', type: 'bytes32' }, { name: 'salt', type: 'bytes32' },
  ], outputs: [{ name: 'mandateId', type: 'bytes32' }] },
  { type: 'function', name: 'fundMandate', stateMutability: 'payable', inputs: [{ name: 'mandateId', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'revokeMandate', stateMutability: 'nonpayable', inputs: [{ name: 'mandateId', type: 'bytes32' }], outputs: [] },
  {
    type: 'function', name: 'getMandate', stateMutability: 'view',
    inputs: [{ name: 'mandateId', type: 'bytes32' }],
    outputs: [{ name: 'mandate', type: 'tuple', components: [
      { name: 'principal', type: 'address' },
      { name: 'agentSigner', type: 'address' },
      { name: 'approvedRecipient', type: 'address' },
      { name: 'perCallLimit', type: 'uint256' },
      { name: 'totalLimit', type: 'uint256' },
      { name: 'spent', type: 'uint256' },
      { name: 'expiresAt', type: 'uint64' },
      { name: 'nextNonce', type: 'uint256' },
      { name: 'active', type: 'bool' },
      { name: 'policyHash', type: 'bytes32' },
      { name: 'deposited', type: 'uint256' },
    ] }],
  },
  {
    type: 'function', name: 'executeTransfer', stateMutability: 'nonpayable',
    inputs: [
      { name: 'intent', type: 'tuple', components: [
        { name: 'mandateId', type: 'bytes32' },
        { name: 'recipient', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint64' },
      ] },
      { name: 'signature', type: 'bytes' },
    ], outputs: [],
  },
] as const;
