import { createPasskeyAccount, explainPasskeyError, unlockPasskeyAccount } from './passkey-account.js';

const form = document.querySelector<HTMLFormElement>('#wallet-approval');
const status = document.querySelector<HTMLElement>('#wallet-status');
if (form && status) {
  const value = (name: string): string => {
    const input = form.elements.namedItem(name);
    if (!(input instanceof HTMLInputElement)) throw new Error('Sign-in request was incomplete. Return to your AI client and reconnect.');
    return input.value;
  };
  const messageFor = (address: string): string => {
    const origin = form.dataset.origin;
    const clientName = form.dataset.clientName;
    const resource = form.dataset.resource;
    if (!origin || !clientName || !resource) throw new Error('Sign-in request was incomplete. Return to your AI client and reconnect.');
    const originUrl = new URL(origin);
    return [
      `${originUrl.host} wants you to sign in with your Ethereum account:`, address, '',
      `Connect ${clientName} to Mandate. This signature does not create a blockchain transaction.`, '',
      `URI: ${originUrl.origin}`, 'Version: 1', 'Chain ID: 10143', `Nonce: ${value('wallet_nonce')}`,
      `Issued At: ${new Date(Number(value('issued_at_ms'))).toISOString()}`,
      `Expiration Time: ${new Date(Number(value('expires_at_ms'))).toISOString()}`,
      'Resources:', `- ${resource}`,
    ].join('\n');
  };
  const submit = (address: string, signature: string): void => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address) || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
      throw new Error('The authenticator returned an invalid sign-in proof. Please try again.');
    }
    value('wallet_address');
    value('wallet_signature');
    (form.elements.namedItem('wallet_address') as HTMLInputElement).value = address;
    (form.elements.namedItem('wallet_signature') as HTMLInputElement).value = signature;
    status.textContent = 'Identity verified. Finishing connection…';
    form.requestSubmit();
  };
  const run = async (label: string, action: () => Promise<void>): Promise<void> => {
    if (form.querySelectorAll<HTMLInputElement>('input[name="granted_scope"]:checked').length === 0) {
      status.textContent = 'Select at least one capability before continuing. The transfer option remains off unless you choose it.';
      return;
    }
    const buttons = [...form.querySelectorAll<HTMLButtonElement>('button')];
    buttons.forEach((button) => { button.disabled = true; });
    status.textContent = label;
    try {
      await action();
    } catch (error) {
      status.textContent = `${explainPasskeyError(error)} Return to your AI client after connecting.`;
      buttons.forEach((button) => { button.disabled = false; });
    }
  };

  document.querySelector('#create-passkey')?.addEventListener('click', () => void run('Your device will ask you to create and verify a passkey…', async () => {
    const { session } = await createPasskeyAccount();
    try { submit(session.address, await session.account.signMessage({ message: messageFor(session.address) })); }
    finally { session.end(); }
  }));
  document.querySelector('#unlock-passkey')?.addEventListener('click', () => void run('Choose your Mandate passkey and verify on your device…', async () => {
    const { session } = await unlockPasskeyAccount();
    try { submit(session.address, await session.account.signMessage({ message: messageFor(session.address) })); }
    finally { session.end(); }
  }));
  document.querySelector('#connect-wallet')?.addEventListener('click', () => void run('Your wallet will show the account to connect…', async () => {
    const provider = window.ethereum;
    if (!provider) throw new Error('No browser wallet was detected. Choose a passkey option above, or open this page in a browser with your wallet installed.');
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    const address = Array.isArray(accounts) ? accounts[0] : undefined;
    if (typeof address !== 'string') throw new Error('Your wallet did not return an account. Unlock it and try again.');
    const signature = await provider.request({ method: 'personal_sign', params: [messageFor(address), address] });
    if (typeof signature !== 'string') throw new Error('Your wallet did not return a signature.');
    submit(address, signature);
  }));
}
