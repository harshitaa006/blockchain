import { useEffect, useState } from "react";
import { ethers } from "ethers";
import {
  Activity, ArrowDownToLine, ArrowUpRight, BadgeCheck, Box, Check, ChevronRight,
  CircleAlert, ClipboardCheck, Clock3, FileSearch, Fingerprint, Link2, LoaderCircle,
  LockKeyhole, RefreshCw, ShieldAlert, ShieldCheck, Wallet, Waypoints
} from "lucide-react";
import { api } from "./api.js";
import { escrowAbi } from "./contract.js";

const CONTRACT_ADDRESS = import.meta.env.VITE_ESCROW_ADDRESS || "";
const OUTCOME_LABELS = {
  VERIFIED_DELIVERED: "Verified delivery",
  NOT_VERIFIED: "Not verified",
  REVIEW_REQUIRED: "Manual review"
};

function short(value, left = 8, right = 6) {
  if (!value || value.length <= left + right + 3) return value || "Not available";
  return `${value.slice(0, left)}...${value.slice(-right)}`;
}

function Outcome({ value }) {
  const kind = value === "VERIFIED_DELIVERED" ? "good" : value === "NOT_VERIFIED" ? "bad" : "review";
  const Icon = kind === "good" ? ShieldCheck : kind === "bad" ? CircleAlert : ShieldAlert;
  return <span className={`outcome outcome-${kind}`}><Icon size={15} />{OUTCOME_LABELS[value] || "Not analyzed"}</span>;
}

function CheckLine({ label, passed, detail }) {
  return <div className="check-line">
    <span className={`check-mark ${passed ? "check-pass" : "check-fail"}`}>{passed ? <Check size={12} /> : <CircleAlert size={12} />}</span>
    <span className="check-copy"><strong>{label}</strong>{detail && <small>{detail}</small>}</span>
    <span className={`check-state ${passed ? "text-good" : "text-muted"}`}>{passed ? "PASS" : "CHECK"}</span>
  </div>;
}

export default function App() {
  const [health, setHealth] = useState(null);
  const [stats, setStats] = useState({ analyzed: 0, verified: 0, not_verified: 0, review_required: 0 });
  const [records, setRecords] = useState([]);
  const [record, setRecord] = useState(null);
  const [attestation, setAttestation] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [network, setNetwork] = useState(null);
  const [shipmentId, setShipmentId] = useState("PKG-7821");
  const [trackingUrl, setTrackingUrl] = useState("https://tracking.example/PKG-7821");
  const [escrowId, setEscrowId] = useState("");
  const [sellerAddress, setSellerAddress] = useState("");
  const [amount, setAmount] = useState("0.01");
  const [busy, setBusy] = useState("");
  const [transaction, setTransaction] = useState(null);
  const [error, setError] = useState("");

  async function refresh() {
    const results = await Promise.allSettled([api.health(), api.stats(), api.listEvidence()]);
    if (results[0].status === "fulfilled") setHealth(results[0].value);
    if (results[1].status === "fulfilled") setStats(results[1].value);
    if (results[2].status === "fulfilled") setRecords(results[2].value);
  }

  useEffect(() => { refresh(); }, []);

  async function connectWallet() {
    setError("");
    if (!window.ethereum) {
      setError("A browser wallet is needed for local escrow transactions.");
      return;
    }
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send("eth_requestAccounts", []);
      const chain = await provider.getNetwork();
      setWallet(accounts[0]);
      setNetwork(`${chain.name} · ${chain.chainId}`);
      window.ethereum.on?.("chainChanged", () => window.location.reload());
    } catch (issue) {
      setError(issue.shortMessage || issue.message || "Wallet connection failed.");
    }
  }

  async function createEscrow() {
    setError("");
    if (!wallet || !window.ethereum) return setError("Connect a wallet before creating an escrow.");
    if (!CONTRACT_ADDRESS) return setError("Set VITE_ESCROW_ADDRESS after deploying the local contract.");
    if (!ethers.isAddress(sellerAddress)) return setError("Enter a valid seller wallet address.");
    setBusy("create");
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(CONTRACT_ADDRESS, escrowAbi, signer);
      const id = ethers.hexlify(ethers.randomBytes(32));
      const response = await contract.createEscrow(id, shipmentId, sellerAddress, { value: ethers.parseEther(amount) });
      setTransaction({ hash: response.hash, status: "Confirming escrow deposit" });
      await response.wait();
      setEscrowId(id);
      setTransaction({ hash: response.hash, status: "Escrow funded on-chain" });
    } catch (issue) {
      setError(issue.shortMessage || issue.message || "Escrow transaction failed.");
    } finally {
      setBusy("");
    }
  }

  async function analyze() {
    setError("");
    setAttestation(null);
    setTransaction(null);
    setBusy("analyze");
    try {
      const result = await api.analyze({ shipment_id: shipmentId, tracking_url: trackingUrl, ...(escrowId ? { escrow_id: escrowId } : {}) });
      setRecord(result);
      await refresh();
    } catch (issue) {
      setError(issue.message || "Evidence analysis failed.");
    } finally {
      setBusy("");
    }
  }

  async function signResult() {
    if (!record?.record?.record_id) return;
    setError("");
    setBusy("sign");
    try {
      const result = await api.sign(record.record.record_id);
      setAttestation({ ...result.attestation, signature_verified: result.signature_verified });
    } catch (issue) {
      setError(issue.message || "Attestation signing failed.");
    } finally {
      setBusy("");
    }
  }

  async function releaseEscrow() {
    if (!attestation || !window.ethereum) return;
    setError("");
    setBusy("release");
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const currentNetwork = await provider.getNetwork();
      if (currentNetwork.chainId !== BigInt(attestation.chain_id)) throw new Error("Wallet is connected to the wrong chain.");
      if (CONTRACT_ADDRESS && CONTRACT_ADDRESS.toLowerCase() !== attestation.contract_address.toLowerCase()) throw new Error("The configured contract does not match the signed attestation.");
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(attestation.contract_address, escrowAbi, signer);
      const sourceId = ethers.keccak256(ethers.toUtf8Bytes(attestation.source_id));
      const response = await contract.release(
        attestation.escrow_id,
        ethers.keccak256(ethers.toUtf8Bytes(attestation.schema_version)),
        ethers.keccak256(ethers.toUtf8Bytes(attestation.attestation_id)),
        attestation.evidence_hash, sourceId,
        attestation.issued_at, attestation.expires_at, attestation.nonce,
        1, attestation.signature
      );
      setTransaction({ hash: response.hash, status: "Confirming attested release" });
      const receipt = await response.wait();
      const released = receipt.logs.some((log) => {
        try { return contract.interface.parseLog(log)?.name === "EscrowReleased"; } catch { return false; }
      });
      setTransaction({ hash: response.hash, status: released ? "Escrow released on-chain" : "Contract rejected the attestation" });
    } catch (issue) {
      setError(issue.shortMessage || issue.message || "Release transaction failed.");
    } finally {
      setBusy("");
    }
  }

  const analyzed = record?.record;
  const verification = analyzed?.verification;
  const extraction = analyzed?.extraction;
  const checks = verification?.checks || {};
  const isDemo = analyzed?.retrieval_mode === "demo_simulated";
  const canSign = verification?.outcome === "VERIFIED_DELIVERED" && Boolean(escrowId) && Boolean(health?.signing_configured);

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#top" aria-label="ProofBridge home"><span className="brand-mark"><Waypoints size={20} /></span><span>proofbridge<small>evidence desk</small></span></a>
      <div className="side-caption">WORKSPACE</div>
      <nav className="side-nav"><a className="nav-item nav-active" href="#overview"><Activity size={17} />Overview</a><a className="nav-item" href="#analysis"><FileSearch size={17} />Evidence analysis</a><a className="nav-item" href="#attestation"><Fingerprint size={17} />Attestations</a><a className="nav-item" href="#blockchain"><Link2 size={17} />On-chain escrow</a></nav>
      <div className="sidebar-spacer" />
      <div className="network-note"><span className={`live-dot ${health ? "dot-live" : ""}`} /><span><b>Backend</b><small>{health ? "Connected" : "Waiting for API"}</small></span><ChevronRight size={15} /></div>
      <div className="side-foot">PROTOTYPE · TEST NETWORK ONLY</div>
    </aside>

    <main className="main-content" id="top">
      <header className="topbar"><div className="breadcrumbs">Workspace <ChevronRight size={14} /> <b>Delivery verification</b></div><div className="top-actions"><span className={`mode-tag ${isDemo || !health || health.retrieval_mode === "demo" ? "mode-demo" : "mode-live"}`}><span />{health?.retrieval_mode === "tinyfish" ? "TINYFISH RETRIEVAL" : "SIMULATED EVIDENCE"}</span><button className="wallet-button" onClick={connectWallet}>{wallet ? <><span className="wallet-connected" />{short(wallet)}</> : <><Wallet size={16} />Connect wallet</>}</button></div></header>

      <section className="page-heading" id="overview"><div><div className="eyebrow"><span className="eyebrow-line" />REAL-WORLD EVIDENCE · ESCROW</div><h1>Delivery verification</h1><p>Evidence is interpreted, checked against contract rules, and signed before the chain can release funds.</p></div><button className="icon-button" title="Refresh records" onClick={() => refresh()}><RefreshCw size={17} /></button></section>

      {!health && <div className="notice notice-warn"><CircleAlert size={17} /><span>Backend is unreachable. Start the FastAPI service to analyze evidence.</span></div>}
      {error && <div className="notice notice-error"><CircleAlert size={17} /><span>{error}</span><button className="notice-dismiss" onClick={() => setError("")}>Dismiss</button></div>}

      <section className="metrics" aria-label="Evidence metrics">
        <div className="metric"><div className="metric-label">ANALYZED RECORDS <FileSearch size={15} /></div><div className="metric-value">{stats.analyzed}</div><div className="metric-foot">Stored verification history</div></div>
        <div className="metric"><div className="metric-label">VERIFIED <ShieldCheck size={15} /></div><div className="metric-value metric-good">{stats.verified}</div><div className="metric-foot">All deterministic checks passed</div></div>
        <div className="metric"><div className="metric-label">NOT VERIFIED <CircleAlert size={15} /></div><div className="metric-value">{stats.not_verified}</div><div className="metric-foot">Delivery condition not established</div></div>
        <div className="metric"><div className="metric-label">MANUAL REVIEW <ShieldAlert size={15} /></div><div className="metric-value metric-amber">{stats.review_required}</div><div className="metric-foot">Ambiguous or suspicious evidence</div></div>
      </section>

      <div className="workspace-grid">
        <section className="panel analysis-panel" id="analysis">
          <div className="panel-heading"><div><span className="step-index">01</span><div><h2>New verification</h2><p>Define the shipment and its authorized source.</p></div></div><span className="required-note">REQUIRED</span></div>
          <div className="form-grid">
            <label className="field"><span>Shipment ID</span><input value={shipmentId} onChange={(event) => setShipmentId(event.target.value)} placeholder="PKG-7821" maxLength={64} /></label>
            <label className="field field-wide"><span>Approved tracking URL</span><input type="url" value={trackingUrl} onChange={(event) => setTrackingUrl(event.target.value)} placeholder="https://carrier.example/track/…" /></label>
            <label className="field"><span>Escrow reference <i>optional</i></span><input value={escrowId} onChange={(event) => setEscrowId(event.target.value)} placeholder="Create escrow below" /></label>
          </div>
          <div className="form-actions"><div className="demo-helper"><span className="sample-stamp">DEMO</span><span>Sample evidence covers <b>PKG-7821</b> only.</span></div><button className="primary-button" onClick={analyze} disabled={busy !== "" || !health}>{busy === "analyze" ? <LoaderCircle className="spin" size={17} /> : <FileSearch size={17} />}{busy === "analyze" ? "Analyzing…" : "Analyze evidence"}<ArrowUpRight size={15} /></button></div>
        </section>

        <section className="panel escrow-create" id="blockchain"><div className="panel-heading"><div><span className="step-index step-orange">02</span><div><h2>Fund local escrow</h2><p>Deposit test funds before requesting a release.</p></div></div><Box size={18} className="heading-icon" /></div>
          <div className="escrow-fields"><label className="field"><span>Seller wallet address</span><input value={sellerAddress} onChange={(event) => setSellerAddress(event.target.value)} placeholder="0x…" /></label><div className="field"><span>Deposit amount <i>test ETH</i></span><div className="amount-field"><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /><span>ETH</span></div></div></div>
          <div className="form-actions escrow-actions"><span className="network-text"><span className="live-dot" />{network || "Local chain · 31337"}</span><button className="secondary-button" onClick={createEscrow} disabled={busy !== "" || !wallet}>{busy === "create" ? <LoaderCircle className="spin" size={16} /> : <ArrowDownToLine size={16} />}{busy === "create" ? "Submitting…" : "Create & deposit"}</button></div>
          {escrowId && <div className="inline-confirm"><Check size={14} />Escrow ready <code>{short(escrowId, 10, 5)}</code></div>}
          {!CONTRACT_ADDRESS && <div className="subtle-note">Deploy the local contract and set its address in the frontend environment to enable deposits.</div>}
        </section>
      </div>

      <section className="results-section" aria-live="polite">
        <div className="section-title"><div><span className="step-index">03</span><div><h2>Evidence result</h2><p>Extracted fields remain untrusted until deterministic checks pass.</p></div></div>{verification && <Outcome value={verification.outcome} />}</div>
        {!analyzed ? <div className="empty-state"><div className="empty-icon"><ClipboardCheck size={23} /></div><div><b>No evidence analyzed</b><p>Submit a shipment above to see retrieval, verification, and security results.</p></div></div> : <div className="results-grid">
          <article className="result-panel evidence-card"><div className="result-title"><FileSearch size={16} /><h3>Extracted evidence</h3><span className={`source-pill ${isDemo ? "pill-demo" : "pill-live"}`}>{isDemo ? "SIMULATED SAMPLE" : "LIVE RETRIEVAL"}</span></div><dl className="detail-list"><div><dt>Source</dt><dd className="url-value">{extraction?.source_url}</dd></div><div><dt>Shipment ID</dt><dd>{extraction?.shipment_id || <span className="missing-value">Not provided</span>}</dd></div><div><dt>Delivery status</dt><dd><span className="status-value">{extraction?.delivery_status || "UNKNOWN"}</span></dd></div><div><dt>Delivery time</dt><dd>{extraction?.delivery_timestamp || <span className="missing-value">Not provided</span>}</dd></div><div className="supporting-row"><dt>Source statement</dt><dd>{extraction?.supporting_evidence || "No supporting statement returned."}</dd></div><div><dt>SHA-256 evidence hash</dt><dd className="hash-value">{analyzed.evidence_hash}</dd></div></dl><div className="result-foot"><span>Record {short(analyzed.record_id, 10, 6)}</span><span>{new Date(analyzed.created_at).toLocaleString()}</span></div></article>

          <article className="result-panel security-card"><div className="result-title"><LockKeyhole size={16} /><h3>Verification gates</h3></div><div className="check-list"><CheckLine label="Source authorization" passed={checks.source_authorized} detail="Configured carrier allowlist" /><CheckLine label="Source binding" passed={checks.source_matches_request} detail="Requested and extracted host" /><CheckLine label="Shipment match" passed={checks.shipment_matches} detail="Expected ID compared independently" /><CheckLine label="Delivery condition" passed={checks.delivered_status} detail="Contract requires DELIVERED" /><CheckLine label="Timestamp" passed={checks.timestamp_valid} detail="Valid and not in the future" /><CheckLine label="Instruction scan" passed={checks.injection_scan_clear} detail="A clear scan is not a safety guarantee" /></div>{verification?.warnings?.length > 0 && <div className="warning-list">{verification.warnings.map((warning) => <p key={warning}><ShieldAlert size={13} />{warning}</p>)}</div>}</article>
        </div>}
      </section>

      <div className="bottom-grid" id="attestation">
        <section className="panel attestation-panel"><div className="panel-heading"><div><span className="step-index step-violet">04</span><div><h2>Cryptographic attestation</h2><p>ECDSA signer · evidence integrity · limited validity</p></div></div><Fingerprint size={18} className="heading-icon" /></div>
          {!attestation ? <div className="attestation-empty"><span><Fingerprint size={19} /></span><div><b>{canSign ? "Ready to sign verified result" : "No signed attestation"}</b><small>{canSign ? "Signing requires an eligible record and configured backend signer." : "Only a verified result bound to an escrow is eligible."}</small></div><button className="secondary-button" onClick={signResult} disabled={!canSign || busy !== ""}>{busy === "sign" ? <LoaderCircle className="spin" size={15} /> : <BadgeCheck size={15} />}{busy === "sign" ? "Signing…" : "Sign result"}</button></div> : <div className="attestation-details"><div className="attestation-success"><BadgeCheck size={17} />Signed by trusted backend component</div><div className="attestation-row"><span>Attestation ID</span><code>{short(attestation.attestation_id, 12, 8)}</code></div><div className="attestation-row"><span>Signer address</span><code>{short(attestation.signer_address)}</code></div><div className="attestation-row"><span>Source identifier</span><code>{attestation.source_id}</code></div><div className="attestation-row"><span>Expires</span><code>{new Date(attestation.expires_at * 1000).toLocaleString()}</code></div><div className="attestation-row"><span>Signature check</span><code>{attestation.signature_verified ? "ECDSA recovery verified" : "Not verified"}</code></div></div>}
        </section>

        <section className="panel chain-panel"><div className="panel-heading"><div><span className="step-index step-orange">05</span><div><h2>Blockchain transaction</h2><p>Wallet submission · local test network</p></div></div><Link2 size={18} className="heading-icon" /></div>
          <div className="chain-summary"><div><span>Connected wallet</span><b>{wallet ? short(wallet) : "Not connected"}</b></div><div><span>Network</span><b>{network || "Not connected"}</b></div><div><span>Escrow amount</span><b>{amount || "0"} ETH</b></div><div><span>Release state</span><b className={transaction?.status === "Escrow released on-chain" ? "text-good" : "text-muted"}>{transaction?.status || "No transaction"}</b></div></div>
          {attestation && <button className="release-button" onClick={releaseEscrow} disabled={busy !== "" || !wallet}>{busy === "release" ? <LoaderCircle className="spin" size={16} /> : <LockKeyhole size={16} />}{busy === "release" ? "Submitting release…" : "Submit attestation to escrow"}<ArrowUpRight size={15} /></button>}
          {transaction?.hash && <div className="transaction-link"><span>TX</span><code>{short(transaction.hash, 12, 8)}</code><Check size={14} /></div>}
          {!wallet && <button className="connect-inline" onClick={connectWallet}><Wallet size={14} />Connect wallet to use the local contract</button>}
        </section>
      </div>

      <section className="records-section"><div className="records-heading"><div><h2>Recent evidence records</h2><p>Persistent analysis history</p></div><span>{records.length} RECORDS</span></div>
        {records.length === 0 ? <div className="records-empty">Records will appear here after analysis.</div> : <div className="records-table"><div className="table-head"><span>SHIPMENT</span><span>SOURCE</span><span>OUTCOME</span><span>MODE</span><span>CREATED</span></div>{records.slice(0, 5).map((item) => <button className="table-row" key={item.record_id} onClick={async () => { try { setRecord(await api.getEvidence(item.record_id)); setAttestation(null); } catch (issue) { setError(issue.message || "Could not load this record."); } }}><span><b>{item.request.shipment_id}</b><small>{short(item.record_id, 10, 5)}</small></span><span className="table-url">{item.extraction?.source_url || item.request.tracking_url}</span><span><Outcome value={item.verification?.outcome} /></span><span>{item.retrieval_mode === "demo_simulated" ? "DEMO" : "TINYFISH"}</span><span>{new Date(item.created_at).toLocaleString()}</span></button>)}</div>}
      </section>

      <footer className="page-footer"><span><Clock3 size={13} />Prototype · test funds only</span><span>Hashes establish integrity, not truth. Signatures authenticate a signer, not a real-world event.</span></footer>
    </main>
  </div>;
}