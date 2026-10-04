export function getTestnetDeploymentConfig(env) {
  const chainId = Number(env.MONAD_CHAIN_ID ?? '10143');
  if (chainId !== 10143) throw new Error('Deployment is restricted to Monad Testnet chain ID 10143');

  const rpcUrl = env.MONAD_RPC_URL;
  if (rpcUrl === undefined || rpcUrl.length === 0) throw new Error('Set MONAD_RPC_URL in .env.local');
  const endpoint = new URL(rpcUrl);
  if (endpoint.protocol !== 'https:') throw new Error('Monad Testnet RPC must use HTTPS');

  const deployerPrivateKey = env.MANDATE_DEPLOYER_PRIVATE_KEY;
  if (deployerPrivateKey === undefined || !/^0x[0-9a-fA-F]{64}$/.test(deployerPrivateKey)) {
    throw new Error('Set MANDATE_DEPLOYER_PRIVATE_KEY in .env.local');
  }

  const existingAddress = env.MANDATE_CONTRACT_ADDRESS;
  if (existingAddress !== undefined && !/^0x0{40}$/i.test(existingAddress)) {
    throw new Error('MANDATE_CONTRACT_ADDRESS is already set; refusing to redeploy');
  }

  return { rpcUrl, chainId, deployerPrivateKey };
}
