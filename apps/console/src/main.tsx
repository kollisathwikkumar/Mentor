import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createPublicClient, createWalletClient, custom, defineChain, encodeAbiParameters, formatEther, http, isAddress, keccak256, parseEther, stringToHex, type Address, type Hex } from 'viem';
import { mandateVaultAbi } from '@mandate/sdk/abi';
import { validateAuthorizationDraft } from './authorization.js';
import { fetchMcpConnectionStatus, type McpConnectionStatus } from './mcp-status.js';
import { registeredTaskCapabilities } from './capabilities.js';
import { submitConversation, type ConversationTurn } from './conversation.js';
import { createPasskeyAccount, explainPasskeyError, unlockPasskeyAccount, type PasskeyAccountSession } from './passkey-account.js';
import './style.css';
interface Provider { request(args: { method: string; params?: readonly string[] }): Promise<readonly string[] | string> }
declare global { interface Window { ethereum?: Provider; __mandateRoot?: Root } }
type ConsolePage = 'home' | 'workspace' | 'connections' | 'space';
function pageFromHash(hash: string): ConsolePage {
  if (hash === '#/workspace') return 'workspace';
  if (hash === '#/connections') return 'connections';
  if (hash === '#/space') return 'space';
  return 'home';
}
const addressText = import.meta.env.VITE_MONAD_CONTRACT_ADDRESS ?? '';
const contractAddress = isAddress(addressText) ? addressText : undefined;
const deploymentBlock = BigInt(import.meta.env.VITE_MANDATE_DEPLOYMENT_BLOCK ?? '0');
const chain = defineChain({ id: 10143, name: 'Monad Testnet', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } } });
const reader = createPublicClient({ chain, transport: http() });
interface RecordView { id: Hex; recipient: Address; total: bigint; spent: bigint; deposited: bigint; active: boolean }
function App(): React.JSX.Element {
  React.useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const revealItems = document.querySelectorAll<HTMLElement>('[data-reveal], .headline-line, .workspace .hero, .workspace .notice, .workspace .task-panel, .workspace .policy-empty, .workspace .grid, .workspace .records, .mcp-page .standalone-heading, .mcp-page .mcp-purpose, .mcp-page .connection-steps, .mcp-page .section-title, .mcp-page .connections, .space-page .space-hero, .space-page .space-stats, .space-page .space-grid, .space-page .space-footer');
    const landing = document.querySelector<HTMLElement>('.landing');
    let frame = 0;
    const updatePointer = (event: PointerEvent): void => {
      if (event.pointerType !== 'mouse') return;
      const x = ((event.clientX / Math.max(1, window.innerWidth)) - 0.5) * 2;
      const y = ((event.clientY / Math.max(1, window.innerHeight)) - 0.5) * 2;
      document.documentElement.style.setProperty('--pointer-x', `${(x * 26).toFixed(1)}px`);
      document.documentElement.style.setProperty('--pointer-y', `${(y * 18).toFixed(1)}deg`);
      document.documentElement.style.setProperty('--pointer-rotation', `${(x * 20).toFixed(1)}deg`);
    };
    const updateScroll = (): void => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        document.documentElement.style.setProperty('--scroll-progress', String(window.scrollY / max));
        const heroHeight = landing?.getBoundingClientRect().height ?? window.innerHeight;
        const heroProgress = Math.min(1, Math.max(0, window.scrollY / Math.max(1, heroHeight * 0.88)));
        document.documentElement.style.setProperty('--hero-progress', heroProgress.toFixed(4));
        const revealStart = window.innerHeight * 0.86;
        const revealEnd = window.innerHeight * 0.48;
        for (const item of revealItems) {
          if (item.getClientRects().length === 0) continue;
          const progress = Math.min(1, Math.max(0, (revealStart - item.getBoundingClientRect().top) / Math.max(1, revealStart - revealEnd)));
          item.style.setProperty('--scroll-reveal', progress.toFixed(3));
        }
      });
    };
    if (!reduceMotion) {
      window.addEventListener('scroll', updateScroll, { passive: true });
      window.addEventListener('resize', updateScroll, { passive: true });
      updateScroll();
      if (window.matchMedia('(pointer: fine)').matches) window.addEventListener('pointermove', updatePointer, { passive: true });
    }
    return () => { window.removeEventListener('scroll', updateScroll); window.removeEventListener('resize', updateScroll); window.removeEventListener('pointermove', updatePointer); if (frame) window.cancelAnimationFrame(frame); };
  }, []);
  const [page, setPage] = React.useState<ConsolePage>(() => pageFromHash(window.location.hash));
  const [previousPage, setPreviousPage] = React.useState<ConsolePage>('home');
  React.useEffect(() => {
    const onHashChange = (): void => {
      const nextPage = pageFromHash(window.location.hash);
      if (nextPage !== page) { setPreviousPage(page); setPage(nextPage); window.scrollTo({ top: 0, behavior: 'instant' }); window.requestAnimationFrame(() => window.dispatchEvent(new Event('scroll'))); }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [page]);
  function goBack(): void { window.location.hash = previousPage === 'home' ? '#/' : `#/${previousPage}`; }
  const [account, setAccount] = React.useState<Address>();
  const [passkeySession, setPasskeySession] = React.useState<PasskeyAccountSession>();
  const passkeySessionRef = React.useRef<PasskeyAccountSession | undefined>(undefined);
  const passkeySessionTimerRef = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => {
    if (passkeySessionTimerRef.current !== undefined) window.clearTimeout(passkeySessionTimerRef.current);
    passkeySessionRef.current?.end();
  }, []);
  const [records, setRecords] = React.useState<readonly RecordView[]>([]);
  const [task, setTask] = React.useState('');
  const [composerText, setComposerText] = React.useState('');
  const [conversation, setConversation] = React.useState<readonly ConversationTurn[]>([{ id: 'welcome', role: 'assistant', content: 'Tell me what you want to get done. Include the goal, constraints, or deadline—whatever context matters.' }]);
  const turnNumber = React.useRef(0);
  const conversationEndRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    conversationEndRef.current?.scrollIntoView({ behavior: reduceMotion ? 'instant' : 'smooth', block: 'end' });
  }, [conversation]);
  const [policyBuilderOpen, setPolicyBuilderOpen] = React.useState(false);
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [agent, setAgent] = React.useState(''); const [recipient, setRecipient] = React.useState('');
  const [perCall, setPerCall] = React.useState(''); const [total, setTotal] = React.useState('');
  const [expiry, setExpiry] = React.useState(''); const [id, setId] = React.useState(''); const [deposit, setDeposit] = React.useState('');
  const [notice, setNotice] = React.useState('Start with a passkey. Your device verifies you and Mandate creates your account—no wallet address or extension to find.');
  const [busy, setBusy] = React.useState(false);
  const mcpEndpoint = import.meta.env.VITE_MANDATE_MCP_URL ?? 'https://mandate-console.pages.dev/mcp';
  const [mcpStatus, setMcpStatus] = React.useState<McpConnectionStatus>();
  const [mcpStatusBusy, setMcpStatusBusy] = React.useState(false);
  const [mcpCopied, setMcpCopied] = React.useState(false);
  async function connect(): Promise<void> {
    if (!window.ethereum) { setNotice('No wallet app was found in this browser. If you already have one, open its browser extension and unlock it; you do not need to type your address. If you are new to Mandate, set up a wallet first.'); return; }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }); const first = accounts[0];
      if (typeof first !== 'string' || !isAddress(first)) throw new Error('No account');
      const network = await window.ethereum.request({ method: 'eth_chainId' });
      if (network !== '0x279f') await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: ['0x279f'] });
      if (passkeySessionTimerRef.current !== undefined) window.clearTimeout(passkeySessionTimerRef.current);
      passkeySessionRef.current?.end(); passkeySessionRef.current = undefined; setPasskeySession(undefined);
      setAccount(first); setNotice('Wallet connected to Monad Testnet.'); await refresh(first);
    } catch { setNotice('Wallet connection or network switch did not complete.'); }
  }
  async function connectPasskey(create: boolean): Promise<void> {
    try {
      const { session } = create ? await createPasskeyAccount() : await unlockPasskeyAccount();
      if (passkeySessionTimerRef.current !== undefined) window.clearTimeout(passkeySessionTimerRef.current);
      passkeySessionRef.current?.end(); passkeySessionRef.current = session; setPasskeySession(session);
      passkeySessionTimerRef.current = window.setTimeout(() => {
        if (passkeySessionRef.current !== session) return;
        session.end(); passkeySessionRef.current = undefined; passkeySessionTimerRef.current = undefined;
        setPasskeySession(undefined); setAccount(undefined); setRecords([]);
        setNotice('Passkey session ended after 15 minutes. Reconnect your passkey to continue.');
      }, 15 * 60 * 1000);
      setAccount(session.address); setNotice('Passkey connected. Your account is ready; no browser wallet extension or address entry was needed.');
      await refresh(session.address);
    } catch (error) {
      setNotice(explainPasskeyError(error));
    }
  }
  function disconnectAccount(): void {
    if (passkeySessionTimerRef.current !== undefined) window.clearTimeout(passkeySessionTimerRef.current);
    passkeySessionTimerRef.current = undefined;
    passkeySessionRef.current?.end(); passkeySessionRef.current = undefined; setPasskeySession(undefined);
    setAccount(undefined); setRecords([]); setNotice('Mandate account disconnected. The in-memory signing session has ended.');
  }
  function walletClientFor(owner: Address) {
    if (passkeySession && passkeySession.address.toLowerCase() === owner.toLowerCase()) {
      return createWalletClient({ account: passkeySession.account, chain, transport: http() });
    }
    if (!window.ethereum) throw new Error('Reconnect the passkey or connect your existing wallet before confirming.');
    return createWalletClient({ account: owner, chain, transport: custom(window.ethereum) });
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
  async function checkMcpConnection(): Promise<void> {
    setMcpStatusBusy(true);
    try {
      const status = await fetchMcpConnectionStatus(mcpEndpoint);
      setMcpStatus(status);
      setNotice(status.connected
        ? 'Mandate is online and has seen authenticated MCP traffic recently.'
        : 'Mandate is online. Connect an MCP client to record a handshake.');
    } catch (error) {
      setMcpStatus(undefined);
      setNotice(error instanceof Error ? error.message : 'MCP status check failed.');
    } finally {
      setMcpStatusBusy(false);
    }
  }
  function continueToPolicy(): void {
    if (!task.trim()) { setNotice('Describe what you want handled in the conversation first.'); return; }
    setPolicyBuilderOpen(true);
    setNotice('This reviews the available MON permission only. It does not run the task you described.');
  }
  function sendMessage(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const result = submitConversation(conversation, composerText, `turn-${++turnNumber.current}`);
    if (!result.ok) {
      setNotice(result.reason === 'empty' ? 'Write a message before sending.' : 'Keep each message under 2,000 characters.');
      return;
    }
    setTask(result.task);
    setConversation(result.messages);
    setComposerText('');
    setPolicyBuilderOpen(false);
    setReviewOpen(false);
    setNotice('Local conversation draft updated. No agent or task API was called.');
  }
  function startNewConversation(): void {
    setConversation([{ id: 'welcome', role: 'assistant', content: 'Tell me what you want to get done. Include the goal, constraints, or deadline—whatever context matters.' }]);
    setComposerText('');
    setTask('');
    setPolicyBuilderOpen(false);
    setReviewOpen(false);
    setNotice('Started a new local conversation draft.');
  }
  function review(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!task.trim()) { setNotice('Describe the task in the conversation first.'); return; }
    const validation = validateAuthorizationDraft({ task, agent, recipient, perCallMon: perCall, totalMon: total, expiresAt: expiry }, Math.floor(Date.now() / 1000));
    if (!validation.ok) { setNotice(validation.message); return; }
    setReviewOpen(true);
    setNotice('Review the permission carefully. Authorizing it does not send a payment.');
  }
  async function authorize(): Promise<void> {
    if (!account || (!passkeySession && !window.ethereum) || !contractAddress) { setNotice('Continue with a passkey or connect your existing wallet before authorizing. No permission has been created.'); return; }
    if (!task.trim()) { setNotice('Describe the task in the conversation first.'); setReviewOpen(false); return; }
    const validation = validateAuthorizationDraft({ task, agent, recipient, perCallMon: perCall, totalMon: total, expiresAt: expiry }, Math.floor(Date.now() / 1000));
    if (!validation.ok) { setNotice(validation.message); setReviewOpen(false); return; }
    setBusy(true);
    try {
      const wallet = walletClientFor(account);
      const bytes = crypto.getRandomValues(new Uint8Array(32)); const salt = ('0x' + Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join('')) as Hex;
      const policyHash = keccak256(stringToHex(JSON.stringify({ agent: validation.agent, recipient: validation.recipient, perCall, total, expiresAt: validation.expiresAt.toString(), version: 1 })));
      const tx = await wallet.writeContract({ address: contractAddress, abi: mandateVaultAbi, functionName: 'createMandate', args: [validation.agent, validation.recipient, validation.perCallWei, validation.totalWei, validation.expiresAt, policyHash, salt] });
      await reader.waitForTransactionReceipt({ hash: tx });
      const mandateId = keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'address' }, { type: 'address' }, { type: 'bytes32' }], [10143n, contractAddress, account, salt]));
      setId(mandateId); setReviewOpen(false); setNotice('Agent access authorized. This registered the permission; it did not send MON to the recipient.'); await refresh(account);
    } catch { setNotice('Authorization did not complete. Review the wallet request.'); }
    finally { setBusy(false); }
  }
  async function fund(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!account || (!passkeySession && !window.ethereum) || !contractAddress || !/^0x[0-9a-fA-F]{64}$/.test(id)) { setNotice('Continue with a passkey or connect a wallet and enter a valid mandate ID.'); return; }
    setBusy(true); try { const wallet = walletClientFor(account);
      const tx = await wallet.writeContract({ address: contractAddress, abi: mandateVaultAbi, functionName: 'fundMandate', args: [id as Hex], value: parseEther(deposit) });
      await reader.waitForTransactionReceipt({ hash: tx }); setNotice('Funding transaction mined.'); await refresh(account);
    } catch { setNotice('Funding did not complete. Check budget and wallet balance.'); } finally { setBusy(false); }
  }
  async function revoke(mandateId: Hex): Promise<void> {
    if (!account || (!passkeySession && !window.ethereum) || !contractAddress) return; setBusy(true);
    try { const wallet = walletClientFor(account);
      const tx = await wallet.writeContract({ address: contractAddress, abi: mandateVaultAbi, functionName: 'revokeMandate', args: [mandateId] });
      await reader.waitForTransactionReceipt({ hash: tx }); setNotice('Revocation mined. Future transfers are blocked onchain.'); await refresh(account);
    } catch { setNotice('Revocation did not complete. Check the wallet transaction.'); } finally { setBusy(false); }
  }
  return <div className={`experience route-${page}`} id="top">
    <div className="scroll-progress" aria-hidden="true"/><div className="ambient-scene" aria-hidden="true"><div className="scene-grid"/><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="core-object"><div className="core-face face-front"/><div className="core-face face-side"/><div className="core-face face-top"/><div className="core-light"/></div><div className="shard shard-left"/><div className="shard shard-right"/><div className="shard shard-low"/><div className="scene-glow"/></div>
    <nav className="site-nav" aria-label="Main navigation"><a className="site-brand" href="#/" aria-label="Mandate home">M<span>—</span></a><div className="nav-links">{page === 'home' && <><a href="#story">The Idea</a><a href="#how">How It Works</a></>}<a href="#/workspace">Workspace</a><a href="#/connections">MCP</a><a href="#/space">Space <span>↗</span></a></div><button className="nav-wallet" type="button" onClick={() => void connectPasskey(false)}>{account ? account.slice(0, 6) + '…' + account.slice(-4) : 'Continue with passkey'} <span>↗</span></button></nav>
    <main className="experience-main">
      <section className="landing" aria-labelledby="landing-title"><div className="landing-overline"><span className="status-pulse"/> AUTONOMY, WITH BOUNDARIES <span className="landing-index">MONAD TESTNET · 01</span></div><div className="landing-center"><span className="landing-orbit-label label-left">POLICY / 001</span><h1 id="landing-title">mandate<span className="title-mark">.</span></h1><p>Permission for agents.<br/><span>Control that stays yours.</span></p><a className="landing-cta" href="#story">DISCOVER THE PROTOCOL <span>↓</span></a><span className="landing-orbit-label label-right">EST. FOR THE OPEN ECONOMY</span></div><div className="landing-foot"><span>PROGRAMMABLE ACCESS ON MONAD</span><a href="#story">SCROLL TO EXPLORE <span>↓</span></a><span>01 — 03</span></div></section>
      <section className="story-section" id="story" aria-labelledby="story-title"><div className="section-meta" data-reveal><span>01 / THE IDEA</span><span>SMALL RULES. REAL AGENCY.</span></div><div className="story-copy" data-reveal><p className="eyebrow">A NEW KIND OF DELEGATION</p><h2 id="story-title"><span className="headline-line"><span>Let your agents</span></span><span className="headline-line"><span>move with purpose.</span></span><span className="headline-line"><span className="muted-line">Not unlimited power.</span></span></h2><p className="story-description">Mandate turns a task into a clear, bounded permission. Set who can act, where value can go, how much can move, and when authority ends — then register that rule on Monad.</p><a className="text-link" href="#how">SEE HOW IT WORKS <span>↓</span></a></div><div className="story-graphic" aria-hidden="true" data-reveal><div className="graphic-ring ring-a"/><div className="graphic-ring ring-b"/><div className="graphic-core"><span>M</span></div><div className="graphic-node node-a">01<br/><b>INTENT</b></div><div className="graphic-node node-b">02<br/><b>BOUNDARY</b></div><div className="graphic-node node-c">03<br/><b>CONTROL</b></div><span className="graphic-caption">A POLICY, MADE LEGIBLE</span></div><div className="story-bottom"><span>THE AGENT ACTS INSIDE THE RULE.</span><span>YOU KEEP THE KEY.</span></div></section>
      <section className="how-section" id="how" aria-labelledby="how-title"><div className="section-meta" data-reveal><span>02 / HOW IT WORKS</span><span>DEFINE → AUTHORIZE → MANAGE</span></div><div className="how-heading" data-reveal><p className="eyebrow">THE MECHANISM</p><h2 id="how-title"><span className="headline-line"><span>A simple boundary</span></span><span className="headline-line"><span>for complex work.</span></span></h2><p>One fixed-recipient native MON policy, with onchain limits and an expiry you choose.</p></div><div className="steps-line" aria-label="Three steps"><article className="step-card" data-reveal><span className="step-number">01</span><div className="step-glyph glyph-task">↗</div><h3>Describe the job</h3><p>Start with what you want your agent to handle. Your task note stays in this browser.</p><span className="step-foot">INTENT, IN YOUR WORDS</span></article><article className="step-card" data-reveal><span className="step-number">02</span><div className="step-glyph glyph-rule">⌁</div><h3>Set the boundary</h3><p>Choose the signer, a single destination, per-action and total MON limits, and an expiry.</p><span className="step-foot">NARROW BY DESIGN</span></article><article className="step-card" data-reveal><span className="step-number">03</span><div className="step-glyph glyph-key">◇</div><h3>Authorize onchain</h3><p>Review the rule, then approve its registration with your wallet. This step does not make a payment.</p><span className="step-foot">YOU STAY IN CONTROL</span></article></div><div className="how-note" data-reveal><span>TESTNET CAPABILITY</span><p>Mandate currently registers fixed-recipient MON access policies. Escrow funding is separate. MCP setup lives on its own page; this workspace only manages onchain permissions.</p></div><a className="workspace-link" href="#/workspace">OPEN THE MANDATE WORKSPACE <span>↘</span></a></section>
      <div className="shell"><aside className="rail"><div className="brand">M<span>.</span></div><small>WORKSPACE</small><div className="nav-active">▦ &nbsp; Agent access</div><div className="rail-foot">POLICY NETWORK<br/><b>MONAD TESTNET</b></div></aside><main className="workspace">
    <header><span>Workspace <i>/</i> Agent access</span><div><button className="header-route-action" type="button" onClick={goBack}>← Back</button><a className="header-route-action" href="#/">Home</a><span className="network"><i/>Monad Testnet</span></div></header>
    <section className="hero"><div><p className="kicker">MANDATE WORKSPACE · MONAD TESTNET</p><h1>What would you like<br/><em>your agent to handle?</em></h1><p className="lede">Describe the work in your own words. Mandate will keep the conversation open and show exactly which permissions this build can enforce.</p></div><div className="stamp"><span>POLICY NETWORK</span><b>MONAD</b><small>TESTNET · 10143</small></div></section>
    <div className="notice" role="status"><i/>{notice}</div>
    <section className="identity-actions" aria-label="Choose how to connect your Mandate account"><div><b>{account ? 'ACCOUNT CONNECTED' : 'START WITHOUT AN EXTENSION'}</b><p>{account ? `${passkeySession ? 'Passkey' : 'Wallet'} account ${account.slice(0, 8)}…${account.slice(-6)}. Keep the same account when connecting your AI client.` : 'Create a passkey or use one you already have. Face ID, fingerprint, or device PIN replaces copying addresses and managing a separate wallet extension.'}</p></div><div className="identity-buttons"><button type="button" className="primary" onClick={() => void connectPasskey(true)} disabled={busy}>Create passkey</button><button type="button" className="secondary" onClick={() => void connectPasskey(false)} disabled={busy}>Use my passkey</button><button type="button" className="text-button" onClick={() => void connect()} disabled={busy}>Use an existing wallet</button>{account && <button type="button" className="text-button" onClick={disconnectAccount} disabled={busy}>{passkeySession ? 'Lock account' : 'Disconnect'}</button>}</div><small>A new passkey creates a new account; use the same account later for MCP sign-in. To manage an existing permission, connect the wallet/passkey account that created it. Passkeys need WebAuthn PRF support. Onchain actions require testnet MON for gas.</small></section>
    <section className="task-panel conversation-panel" aria-labelledby="conversation-title">
      <div className="conversation-heading">
        <div className="conversation-agent"><span className="conversation-mark">M<span>·</span></span><div><p className="kicker">CONVERSATION</p><h2 id="conversation-title">New conversation</h2></div></div>
        <div className="conversation-heading-actions"><span className="conversation-mode"><i/> LOCAL DRAFT</span><button className="conversation-reset" type="button" onClick={startNewConversation}>New chat <b>＋</b></button></div>
      </div>
      <div className="conversation-thread" role="log" aria-live="polite" aria-relevant="additions text">
        {conversation.map((message) => <article className={`conversation-message ${message.role}`} key={message.id}>
          {message.role === 'assistant' && <span className="message-avatar" aria-hidden="true">M<span>·</span></span>}
          <div className="message-body"><small>{message.role === 'assistant' ? 'MANDATE' : 'YOU'}</small><p>{message.content}</p></div>
        </article>)}
        <div ref={conversationEndRef} aria-hidden="true"/>
      </div>
      <form className="conversation-composer" onSubmit={sendMessage}>
        <label className="sr-only" htmlFor="conversation-input">Describe what you want the agent to handle</label>
        <textarea id="conversation-input" value={composerText} onChange={(event) => setComposerText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Tell Mandate what you want the agent to take care of…" maxLength={2_000} rows={3}/>
        <div className="composer-footer"><span>↵ Send · ⇧↵ New line <i/> {composerText.length}/2,000</span><button className="composer-send" type="submit" disabled={!composerText.trim()}>Send <b>↑</b></button></div>
      </form>
      <div className="conversation-boundary"><span className="boundary-icon">⌁</span><div><small>AVAILABLE ENFORCEMENT</small><b>{registeredTaskCapabilities[0]?.label ?? 'No registered action'}</b><p>Only this MON transfer policy is enforced onchain. The conversation does not call an agent, and other task types are not executed.</p></div><button type="button" className="boundary-action" onClick={continueToPolicy} disabled={!task.trim()}>Review access <b>↗</b></button></div>
    </section>
    {policyBuilderOpen ? <>
      <div className="section-title"><div><p className="kicker">STEP 02 · DEFINE THE BOUNDARY</p><h2>Choose what this agent may do</h2></div><small>ACCESS POLICY · NOT A PAYMENT</small></div>
      <div className="grid"><form className="panel" onSubmit={review}><div className="capability"><span>SUPPORTED CAPABILITY</span><b>Pay one fixed recipient in native MON</b><p>This contract supports that policy only. An agent-side execution connector is not yet enabled.</p></div>
        <div className="panel-title"><b>01</b><div><h3>Scope the permission</h3><p>Only these fields become enforceable policy.</p></div></div>
        <label>Agent identity <span>Signer address</span><input value={agent} onChange={(event) => setAgent(event.target.value)} placeholder="0x…" required autoComplete="off"/></label><label>Allowed destination <span>Fixed address</span><input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="0x…" required autoComplete="off"/></label>
        <div className="split"><label>Maximum per action <span>MON</span><input value={perCall} onChange={(event) => setPerCall(event.target.value)} inputMode="decimal" placeholder="e.g. 0.01" required/></label><label>Total authority budget <span>MON</span><input value={total} onChange={(event) => setTotal(event.target.value)} inputMode="decimal" placeholder="e.g. 0.02" required/></label></div>
        <label>Permission expires <span>Local timezone</span><input type="datetime-local" value={expiry} onChange={(event) => setExpiry(event.target.value)} required/></label><div className="policy-note">This stage creates an access rule only. It cannot send value to the recipient; funding and agent execution are separate actions.</div><button className="primary" disabled={busy}>Review access policy <b>→</b></button>
      </form><div className="side"><article className="proof"><div><span className="check">✓</span><small>HOW ACCESS WORKS</small></div><h3>Permission before execution.</h3><p>A wallet registers the rule onchain. Connect your local agent from the dedicated MCP page; this contract currently enforces fixed-recipient MON transfers.</p><ul><li>01 <b>Fixed destination</b></li><li>02 <b>Hard limits</b></li><li>03 <b>Revoke access</b></li></ul></article>
        <details className="funding-details"><summary>Optional · prepare funds for a MON permission</summary><p>Funding is a separate wallet action. Deposited MON stays in escrow until a later authorized agent action or withdrawal after revocation.</p><form className="panel" onSubmit={(event) => void fund(event)}><label>Permission ID<input value={id} onChange={(event) => setId(event.target.value)} placeholder="Created after authorization" required autoComplete="off"/></label><label>Escrow amount <span>MON</span><input value={deposit} onChange={(event) => setDeposit(event.target.value)} inputMode="decimal" placeholder="e.g. 0.02" required/></label><button className="secondary" disabled={busy}>Add escrow funds <b>↗</b></button></form></details></div></div>
    </> : null}
    <section className="records"><div className="section-title"><div><p className="kicker">LIVE ACCESS STATE</p><h2>Agent permissions <sup>{records.length.toString().padStart(2, '0')}</sup></h2></div><button className="refresh" onClick={() => void refresh()} disabled={busy}>↻ &nbsp; Refresh records</button></div>
      {records.length === 0 ? <div className="empty"><div className="monogram">M</div><div><b>No agent permissions found for this account</b><p>A permission appears here only under the wallet account that created it. If you expected one, connect that same account. New to Mandate? Create a permission above first.</p></div><small>CHAIN VERIFIED · 10143</small></div> : records.map((item) => <article className="record" key={item.id}><div><small>ACCESS ID</small><code>{item.id.slice(0, 10)}…{item.id.slice(-8)}</code></div><div><small>FIXED DESTINATION</small><code>{item.recipient.slice(0, 6)}…{item.recipient.slice(-4)}</code></div><div><small>USED / TOTAL AUTHORITY</small><b>{formatEther(item.spent)} <i>/ {formatEther(item.total)} MON</i></b></div><div><small>ESCROW AVAILABLE</small><b>{formatEther(item.deposited)} MON</b></div><div><i className={item.active ? 'active-dot' : 'off-dot'}/>{item.active ? 'Active' : 'Revoked'}</div>{item.active && <button className="revoke" onClick={() => void revoke(item.id)} disabled={busy}>Revoke access</button>}</article>)}
    </section><footer><span>MANDATE · AGENT ACCESS CONTROL</span><span>POLICY IS ENFORCED ON MONAD TESTNET <i>●</i></span></footer>
    {reviewOpen && <div className="modal-backdrop"><section className="review-sheet" role="dialog" aria-modal="true" aria-labelledby="review-title"><p className="kicker">STEP 03 · HUMAN REVIEW</p><h2 id="review-title">Review agent access</h2><p className="review-intro">Review the independent onchain permission. This does not execute the task from your conversation.</p><dl className="review-grid"><div><dt>Task</dt><dd>{task}</dd></div><div><dt>Available permission</dt><dd>{registeredTaskCapabilities[0]?.label ?? 'No registered action'} · not connected to this task execution</dd></div><div><dt>Agent signer</dt><dd>{agent}</dd></div><div><dt>Fixed destination</dt><dd>{recipient}</dd></div><div><dt>Per-action maximum</dt><dd>{perCall} MON</dd></div><div><dt>Total authority</dt><dd>{total} MON</dd></div><div><dt>Expires</dt><dd>{new Date(expiry).toLocaleString()}</dd></div></dl><div className="review-note"><b>No payment happens here.</b> Wallet confirmation records this access policy on Monad. Escrow funding and any later agent action are separate.</div><div className="review-actions"><button className="secondary" type="button" onClick={() => setReviewOpen(false)}>Edit policy</button>{!account && <button className="secondary" type="button" onClick={() => void connect()}>Connect wallet</button>}<button className="primary" type="button" onClick={() => void authorize()} disabled={!account || busy}>{busy ? 'Waiting for wallet…' : 'Authorize agent access'} <b>↗</b></button></div></section></div>}
  </main></div>
    <section className="standalone-page mcp-page" aria-labelledby="connections-title">
      <div className="page-breadcrumb"><div className="breadcrumb-labels"><a href="#/space">SPACE</a><span>/</span><span>MCP CONNECTION</span></div><div className="page-route-actions"><button type="button" onClick={goBack}>← Back</button><a href="#/">Home</a></div></div>
      <div className="standalone-heading mcp-hero">
        <div><p className="kicker">REMOTE MCP · STREAMABLE HTTP</p><h1 id="connections-title">Connect your<br/><em>AI client.</em></h1><p>Use one hosted MCP URL with any client that supports remote Streamable HTTP. Sign in once in the client’s normal browser window; Mandate never asks you to copy a server key.</p></div>
      </div>
      <div className="connections mcp-setup-card" id="connections">
        <div className="mcp-endpoint-row">
          <label htmlFor="mcp-endpoint">HOSTED MCP URL<input id="mcp-endpoint" value={mcpEndpoint} readOnly aria-label="Hosted Mandate MCP URL"/></label>
          <button type="button" className="copy-config mcp-url-copy" onClick={() => { void navigator.clipboard.writeText(mcpEndpoint).then(() => { setMcpCopied(true); setNotice('Mandate MCP URL copied. Add it as a remote Streamable HTTP server in your AI client.'); }).catch(() => setNotice('Clipboard access was blocked. Select and copy the URL manually.')); }}>{mcpCopied ? 'COPIED ✓' : 'COPY URL'}</button>
        </div>
        <p className="mcp-explanation">Add a <b>remote MCP server</b> and paste this URL. At sign-in, use your Mandate passkey—your device verifies you and picks the account automatically. No address, API key, or browser extension to find. Passkeys require WebAuthn PRF support; if your authenticator does not support it, use an existing EVM wallet instead. Sign-in is a free message signature, not a transaction. Choose read-only status, review-only proposal, or transfer access only when you need it.</p>
        <div className="mcp-status-row"><div className="mcp-status-copy" aria-live="polite"><span className={mcpStatus ? (mcpStatus.ready ? (mcpStatus.connected ? 'mcp-status-dot is-connected' : 'mcp-status-dot is-ready') : 'mcp-status-dot') : 'mcp-status-dot is-unknown'}/><div><strong>{mcpStatus ? (mcpStatus.ready ? (mcpStatus.connected ? 'CONNECTED · RECENT AUTHENTICATED REQUEST' : 'SERVICE ONLINE · WAITING FOR CLIENT') : 'SERVICE NEEDS CONFIGURATION') : 'SERVICE STATUS NOT CHECKED'}</strong><small>{mcpStatus ? (mcpStatus.ready ? (mcpStatus.connected ? 'A client authenticated within the last five minutes.' : 'The hosted endpoint is ready. Register it in your client and complete its handshake.') : 'The hosted authorization service is not ready. Try again later.') : 'Checks endpoint readiness. A client handshake is needed to show recent activity.'}</small></div></div><button type="button" className="mcp-check-button" onClick={() => void checkMcpConnection()} disabled={mcpStatusBusy}>{mcpStatusBusy ? 'CHECKING…' : 'CHECK SERVICE'}</button></div>
        <p className="mcp-status-disclaimer">The same OAuth connection works across clients that support remote MCP authentication. Access is tied to your Mandate account; read and transfer requests are limited to mandates owned by that account. Proposals are review-only; a proposal does not change a policy or send a transaction. The AI client may ask separately before a transfer request.</p>
      </div>
    </section>
    </main></div>
}
const mount = document.getElementById('root'); if (!mount) throw new Error('Missing React mount element');
const root = window.__mandateRoot ?? createRoot(mount);
window.__mandateRoot = root;
root.render(<React.StrictMode><App/></React.StrictMode>);
