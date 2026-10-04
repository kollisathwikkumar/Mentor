import { describe, expect, it } from 'vitest';
import { getTestnetDeploymentConfig } from './deployment-config.mjs';

const valid = {
  MONAD_RPC_URL: 'https://testnet-rpc.monad.xyz',
  MONAD_CHAIN_ID: '10143',
  MANDATE_DEPLOYER_PRIVATE_KEY: `0x${'1'.repeat(64)}`,
  MANDATE_CONTRACT_ADDRESS: '0x0000000000000000000000000000000000000000',
};

describe('Monad Testnet deployment preflight', () => {
  it('accepts a complete Testnet deployment config', () => {
    expect(getTestnetDeploymentConfig(valid)).toMatchObject({
      rpcUrl: 'https://testnet-rpc.monad.xyz',
      chainId: 10143,
      deployerPrivateKey: valid.MANDATE_DEPLOYER_PRIVATE_KEY,
    });
  });

  it('requires an explicit deployer key before any deployment call', () => {
    expect(() => getTestnetDeploymentConfig({ ...valid, MANDATE_DEPLOYER_PRIVATE_KEY: '' }))
      .toThrow('Set MANDATE_DEPLOYER_PRIVATE_KEY in .env.local');
  });

  it('refuses a chain id other than Monad Testnet', () => {
    expect(() => getTestnetDeploymentConfig({ ...valid, MONAD_CHAIN_ID: '1' }))
      .toThrow('Deployment is restricted to Monad Testnet chain ID 10143');
  });

  it('refuses to overwrite a previously configured deployment', () => {
    expect(() => getTestnetDeploymentConfig({ ...valid, MANDATE_CONTRACT_ADDRESS: '0x1111111111111111111111111111111111111111' }))
      .toThrow('MANDATE_CONTRACT_ADDRESS is already set; refusing to redeploy');
  });
});
