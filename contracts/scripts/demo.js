const { ethers } = require("hardhat");

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || `Backend returned HTTP ${response.status}`);
  return data;
}

async function main() {
  const contractAddress = process.env.ESCROW_CONTRACT_ADDRESS;
  if (!contractAddress || !ethers.isAddress(contractAddress)) {
    throw new Error("Set ESCROW_CONTRACT_ADDRESS in backend/.env after deploying the contract.");
  }
  const apiBase = process.env.PROOFBRIDGE_API_BASE_URL || "http://127.0.0.1:8000";
  const [buyer, seller] = await ethers.getSigners();
  const contract = (await ethers.getContractFactory("ProofBridgeEscrow")).attach(contractAddress).connect(buyer);
  const shipmentId = "PKG-7821";
  const escrowId = ethers.hexlify(ethers.randomBytes(32));

  const deposit = await contract.createEscrow(escrowId, shipmentId, seller.address, {
    value: ethers.parseEther("0.01")
  });
  await deposit.wait();
  console.log(`LOCAL TEST ESCROW FUNDED: ${escrowId}`);
  console.log(`Deposit transaction: ${deposit.hash}`);

  const analyzed = await postJson(`${apiBase}/api/evidence/analyze`, {
    shipment_id: shipmentId,
    tracking_url: "https://tracking.example/PKG-7821",
    escrow_id: escrowId
  });
  const record = analyzed.record;
  console.log(`Evidence retrieval mode: ${record.retrieval_mode}`);
  console.log(`Verification outcome: ${record.verification.outcome}`);
  if (record.verification.outcome !== "VERIFIED_DELIVERED") {
    console.log("No release submitted because deterministic verification did not pass.");
    return;
  }

  const signed = await postJson(`${apiBase}/api/attestations/${record.record_id}/sign`, {});
  const attestation = signed.attestation;
  const sourceId = ethers.keccak256(ethers.toUtf8Bytes(attestation.source_id));
  const release = await contract.release(
    attestation.escrow_id,
    ethers.keccak256(ethers.toUtf8Bytes(attestation.schema_version)),
    ethers.keccak256(ethers.toUtf8Bytes(attestation.attestation_id)),
    attestation.evidence_hash,
    sourceId,
    attestation.issued_at,
    attestation.expires_at,
    attestation.nonce,
    1,
    attestation.signature
  );
  const receipt = await release.wait();
  const released = receipt.logs.some((log) => {
    try { return contract.interface.parseLog(log)?.name === "EscrowReleased"; } catch { return false; }
  });
  console.log(`Release transaction: ${release.hash}`);
  console.log(released ? "LOCAL TEST ESCROW RELEASED" : "CONTRACT REJECTED THE ATTESTATION");
}

main().catch((error) => {
  console.error(error.shortMessage || error.message);
  process.exitCode = 1;
});