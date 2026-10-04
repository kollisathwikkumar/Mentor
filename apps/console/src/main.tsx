import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createPublicClient, createWalletClient, custom, defineChain, encodeAbiParameters, formatEther, http, isAddress, keccak256, parseEther, stringToHex, type Address, type Hex } from 'viem';
import { mandateVaultAbi } from '@mandate/sdk/abi';
import './style.css';
interface Provider { request(args: { method: string; params?: readonly string[] }): Promise<readonly string[] | string> }
declare global { interface Window { ethereum?: Provider; __mandateRoot?: Root } }
const addressText = import.meta.env.VITE_MONAD_CONTRACT_ADDRESS ?? '';
const contractAddress = isAddress(addressText) ? addressText : undefined;
const deploymentBlock = BigInt(import.meta.env.VITE_MANDATE_DEPLOYMENT_BLOCK ?? '0');
const chain = defineChain({ id: 10143, name: 'Monad Testnet', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } } });
const reader = createPublicClient({ chain, transport: http() });
interface RecordView { id: Hex; recipient: Address; total: bigint; spent: bigint; deposited: bigint; active: boolean }
function App(): React.JSX.Element {
  const [account, setAccount] = React.useState<Address>();
  const [records, setRecords] = React.useState<readonly RecordView[]>([]);
  const [agent, setAgent] = React.useState(''); const [recipient, setRecipient] = React.useState('');
  const [perCall, setPerCall] = React.useState('1'); const [total, setTotal] = React.useState('5');
  const [expiry, setExpiry] = React.useState(''); const [id, setId] = React.useState(''); const [deposit, setDeposit] = React.useState('1');
  const [notice, setNotice] = React.useState('Connect your wallet to read and manage onchain mandates.');
  const [busy, setBusy] = React.useState(false);
  async function connect(): Promise<void> {
    if (!window.ethereum) { setNotice('No EIP-1193 browser wallet detected.'); return; }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }); const first = accounts[0];
      if (typeof first !== 'string' || !isAddress(first)) throw new Error('No account');
      const network = await window.ethereum.request({ method: 'eth_chainId' });
      if (network !== '0x279f') await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: ['0x279f'] });
      setAccount(first); setNotice('Wallet connected to Monad Testnet.'); await refresh(first);
    } catch { setNotice('Wallet connection or network switch did not complete.'); }
  }
  async function refresh(owner = account): Promise<void> {
    if (!owner || !contractAddress) { setNotice('Configure the contract address and connect a wallet.'); return; }
    setBusy(true);
    try {
      const logs = await reader.getLogs({ address: contractAddress, event: { type: 'event', name: 'MandateCreated', anonymous: false, inputs: [
        { name: 'mandateId', type: 'bytes32', indexed: true }, { name: 'principal', type: 'address', indexed: true }, { name: 'agentSigner', type: 'address', indexed: true }, { name: 'recipient', type: 'address', indexed: false },
      ] }, args: { principal: owner }, fromBlock: deploymentBlock });
      const ids = [...new Set(logs.flatMap((log) => log.args.mandateId ? [log.args.mandateId] : []))];
      const found = await Promise.all(ids.map(async (mandateId): Promise<RecordView | undefined> => {
        try { const s = await reader.readContract({ address: contractAddress, abi: mandateVaultAbi, functionName: 'getMandate', args: [mandateId] });
          return { id: mandateId, recipient: s.approvedRecipient, total: s.totalLimit, spent: s.spent, deposited: s.deposited, active: s.active };
        } catch { return undefined; }
      }));
      setRecords(found.filter((item): item is RecordView => item !== undefined).reverse()); setNotice('Mandates refreshed from Monad Testnet.');
    } catch { setNotice('Could not read contract state. Verify address and RPC settings.'); }
    finally { setBusy(false); }
  }
  async function create(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!account || !window.ethereum || !contractAddress || !isAddress(agent) || !isAddress(recipient) || !expiry) { setNotice('Connect wallet and provide valid addresses, expiry, and contract settings.'); return; }
    const expiryAt = BigInt(Math.floor(new Date(expiry).getTime() / 1000)); const callWei = parseEther(perCall); const totalWei = parseEther(total);
    if (expiryAt <= BigInt(Math.floor(Date.now() / 1000)) || callWei <= 0n || totalWei < callWei) { setNotice('Expiry must be future; total budget must meet the per-transfer cap.'); return; }
    setBusy(true);
    try {
      const wallet = createWalletClient({ account, chain, transport: custom(window.ethereum) });
      const bytes = crypto.getRandomValues(new Uint8Array(32)); const salt = ('0x' + Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join('')) as Hex;
      const policyHash = keccak256(stringToHex(JSON.stringify({ agent, recipient, perCall, total, expiresAt: expiryAt.toString(), version: 1 })));
      const tx = await wallet.writeContract({ address: contractAddress, abi: mandateVaultAbi, functionName: 'createMandate', args: [agent, recipient, callWei, totalWei, expiryAt, policyHash, salt] });
      await reader.waitForTransactionReceipt({ hash: tx });
      const mandateId = keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'address' }, { type: 'address' }, { type: 'bytes32' }], [10143n, contractAddress, account, salt]));
      setId(mandateId); setNotice('Mandate created and mined. Fund it before execution.'); await refresh(account);
    } catch { setNotice('Creation did not complete. Review the wallet transaction.'); }
    finally { setBusy(false); }
  }
  async function fund(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!account || !window.ethereum || !contractAddress || !/^0x[0-9a-fA-F]{64}$/.test(id)) { setNotice('Connect wallet and enter a valid mandate ID.'); return; }
    setBusy(true); try { const wallet = createWalletClient({ account, chain, transport: custom(window.ethereum) });
      const tx = await wallet.writeContract({ address: contractAddress, abi: mandateVaultAbi, functionName: 'fundMandate', args: [id as Hex], value: parseEther(deposit) });
      await reader.waitForTransactionReceipt({ hash: tx }); setNotice('Funding transaction mined.'); await refresh(account);
    } catch { setNotice('Funding did not complete. Check budget and wallet balance.'); } finally { setBusy(false); }
  }
  async function revoke(mandateId: Hex): Promise<void> {
    if (!account || !window.ethereum || !contractAddress) return; setBusy(true);
    try { const wallet = createWalletClient({ account, chain, transport: custom(window.ethereum) });
      const tx = await wallet.writeContract({ address: contractAddress, abi: mandateVaultAbi, functionName: 'revokeMandate', args: [mandateId] });
      await reader.waitForTransactionReceipt({ hash: tx }); setNotice('Revocation mined. Future transfers are blocked onchain.'); await refresh(account);
    } catch { setNotice('Revocation did not complete. Check the wallet transaction.'); } finally { setBusy(false); }
  }
  return <div className="shell"><aside className="rail"><div className="brand">M<span>.</span></div><small>CONTROL</small><div className="nav-active">▦ &nbsp; Mandates</div><div className="nav-muted">⌁ &nbsp; Activity</div><div className="rail-foot">TESTNET<br/><b>MONAD</b></div></aside><main>
    <header><span>Workspace <i>/</i> Mandates</span><div><span className="network"><i/>Monad Testnet</span><button className="wallet" onClick={() => void connect()}>{account ? account.slice(0, 6) + '…' + account.slice(-4) : 'Connect wallet'}</button></div></header>
    <section className="hero"><div><p className="kicker">AUTHORIZATION CONTROL PLANE <span>01 / 03</span></p><h1>Bounded authority.<br/><em>Verifiable execution.</em></h1><p className="lede">Give an agent a narrow mandate—not your whole wallet. Every transfer is scoped, capped, and independently checked onchain.</p></div><div className="stamp"><span>LIVE POLICY</span><b>MONAD</b><small>TESTNET · 10143</small></div></section>
    <div className="notice" role="status"><i/>{notice}<button onClick={() => void refresh()} disabled={busy}>Refresh ↗</button></div>
    <div className="section-title"><div><p className="kicker">POLICY MANAGEMENT</p><h2>Create a mandate</h2></div><small>01 — DEFINE SCOPE</small></div>
    <div className="grid"><form className="panel" onSubmit={(event) => void create(event)}><div className="panel-title"><b>01</b><div><h3>Set the boundaries</h3><p>The contract holds the rule. Your wallet confirms it.</p></div></div>
      <label>Agent signer <span>Public address</span><input value={agent} onChange={(event) => setAgent(event.target.value)} placeholder="0x…" required autoComplete="off"/></label><label>Approved recipient <span>Fixed destination</span><input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="0x…" required autoComplete="off"/></label>
      <div className="split"><label>Per-transfer cap <span>MON</span><input value={perCall} onChange={(event) => setPerCall(event.target.value)} inputMode="decimal" required/></label><label>Total budget <span>MON</span><input value={total} onChange={(event) => setTotal(event.target.value)} inputMode="decimal" required/></label></div>
      <label>Mandate expires <span>Local timezone</span><input type="datetime-local" value={expiry} onChange={(event) => setExpiry(event.target.value)} required/></label><div className="policy-note">◎ &nbsp; Native MON only; fixed recipient. Contract enforces limits, expiry, replay protection, and revocation.</div><button className="primary" disabled={busy}>{busy ? 'Waiting for confirmation…' : 'Review & create mandate'} <b>↗</b></button>
    </form><div className="side"><form className="panel" onSubmit={(event) => void fund(event)}><div className="panel-title"><b className="pale">02</b><div><h3>Fund a mandate</h3><p>Escrow only what the policy allows.</p></div></div><label>Mandate ID<input value={id} onChange={(event) => setId(event.target.value)} placeholder="0x… (32 bytes)" required autoComplete="off"/></label><label>Deposit amount <span>MON</span><input value={deposit} onChange={(event) => setDeposit(event.target.value)} inputMode="decimal" required/></label><button className="secondary" disabled={busy}>Deposit MON <b>↗</b></button></form>
      <article className="proof"><div><span className="check">✓</span><small>ENFORCED ONCHAIN</small></div><h3>Policy is not a prompt.</h3><p>The model can suggest an action. The wallet and contract decide what is authorized.</p><ul><li>01 <b>Fixed recipient</b></li><li>02 <b>Spend ceiling</b></li><li>03 <b>Revocation</b></li></ul></article></div></div>
    <section className="records"><div className="section-title"><div><p className="kicker">ONCHAIN STATE</p><h2>Your mandates <sup>{records.length.toString().padStart(2, '0')}</sup></h2></div><button className="refresh" onClick={() => void refresh()} disabled={busy}>↻ &nbsp; Refresh records</button></div>
      {records.length === 0 ? <div className="empty"><div className="monogram">M</div><div><b>No mandates found for this wallet</b><p>Create a mandate above, then fund it to enable bounded transfers.</p></div><small>CHAIN VERIFIED · 10143</small></div> : records.map((item) => <article className="record" key={item.id}><div><small>MANDATE ID</small><code>{item.id.slice(0, 10)}…{item.id.slice(-8)}</code></div><div><small>RECIPIENT</small><code>{item.recipient.slice(0, 6)}…{item.recipient.slice(-4)}</code></div><div><small>SPENT / BUDGET</small><b>{formatEther(item.spent)} <i>/ {formatEther(item.total)} MON</i></b></div><div><small>DEPOSITED</small><b>{formatEther(item.deposited)} MON</b></div><div><i className={item.active ? 'active-dot' : 'off-dot'}/>{item.active ? 'Active' : 'Revoked'}</div>{item.active && <button className="revoke" onClick={() => void revoke(item.id)} disabled={busy}>Revoke</button>}</article>)}
    </section><footer><span>MANDATE PROTOCOL · TESTNET BUILD 0.1.0</span><span>AUTHORIZATION LIVES ONCHAIN <i>●</i></span></footer>
  </main></div>;
}
const mount = document.getElementById('root'); if (!mount) throw new Error('Missing React mount element');
const root = window.__mandateRoot ?? createRoot(mount);
window.__mandateRoot = root;
root.render(<React.StrictMode><App/></React.StrictMode>);
