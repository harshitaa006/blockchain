const { expect } = require("chai");
const { ethers } = require("hardhat");

const coder = ethers.AbiCoder.defaultAbiCoder();

async function signedAttestation(contract, signer, escrowId, shipmentId, overrides = {}) {
  const network = await ethers.provider.getNetwork();
  const latest = await ethers.provider.getBlock("latest");
  const issuedAt = overrides.issuedAt ?? latest.timestamp;
  const expiresAt = overrides.expiresAt ?? latest.timestamp + 600;
  const evidenceHash = overrides.evidenceHash ?? ethers.sha256(ethers.toUtf8Bytes("sample evidence"));
  const sourceId = overrides.sourceId ?? ethers.keccak256(ethers.toUtf8Bytes("tracking.example"));
  const schemaVersion = ethers.keccak256(ethers.toUtf8Bytes("1"));
  const attestationId = ethers.keccak256(ethers.toUtf8Bytes(ethers.hexlify(ethers.randomBytes(16))));
  const nonce = overrides.nonce ?? ethers.hexlify(ethers.randomBytes(32));
  const outcome = overrides.outcome ?? 1;
  const digest = ethers.keccak256(coder.encode(
    ["uint256", "address", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32", "uint64", "uint64", "bytes32", "uint8"],
    [network.chainId, await contract.getAddress(), schemaVersion, attestationId, escrowId, ethers.keccak256(ethers.toUtf8Bytes(shipmentId)), evidenceHash, sourceId, issuedAt, expiresAt, nonce, outcome]
  ));
  return {
    evidenceHash,
    sourceId,
    schemaVersion,
    attestationId,
    issuedAt,
    expiresAt,
    nonce,
    outcome,
    signature: await signer.signMessage(ethers.getBytes(digest))
  };
}

describe("ProofBridgeEscrow", function () {
  async function fixture() {
    const [buyer, seller, owner] = await ethers.getSigners();
    const signer = ethers.Wallet.createRandom();
    const factory = await ethers.getContractFactory("ProofBridgeEscrow", owner);
    const contract = await factory.deploy(signer.address);
    await contract.waitForDeployment();
    const escrowId = ethers.hexlify(ethers.randomBytes(32));
    const shipmentId = "PKG-7821";
    await contract.connect(buyer).createEscrow(escrowId, shipmentId, seller.address, { value: ethers.parseEther("1") });
    return { contract, buyer, seller, signer, escrowId, shipmentId };
  }

  it("releases only after a valid signed delivery attestation", async function () {
    const f = await fixture();
    const attestation = await signedAttestation(f.contract, f.signer, f.escrowId, f.shipmentId);
    const before = await ethers.provider.getBalance(f.seller.address);
    await expect(f.contract.release(f.escrowId, attestation.schemaVersion, attestation.attestationId, attestation.evidenceHash, attestation.sourceId, attestation.issuedAt, attestation.expiresAt, attestation.nonce, attestation.outcome, attestation.signature))
      .to.emit(f.contract, "AttestationAccepted").and.to.emit(f.contract, "EscrowReleased");
    expect(await ethers.provider.getBalance(f.seller.address)).to.equal(before + ethers.parseEther("1"));
  });

  it("rejects an invalid signature without releasing funds", async function () {
    const f = await fixture();
    const stranger = ethers.Wallet.createRandom();
    const attestation = await signedAttestation(f.contract, stranger, f.escrowId, f.shipmentId);
    await expect(f.contract.release(f.escrowId, attestation.schemaVersion, attestation.attestationId, attestation.evidenceHash, attestation.sourceId, attestation.issuedAt, attestation.expiresAt, attestation.nonce, attestation.outcome, attestation.signature))
      .to.emit(f.contract, "AttestationRejected").withArgs(f.escrowId, 6);
    expect((await f.contract.escrows(f.escrowId)).released).to.equal(false);
  });

  it("rejects wrong-shipment, expired, and non-delivery attestations", async function () {
    const f = await fixture();
    const latest = await ethers.provider.getBlock("latest");
    const wrongShipment = await signedAttestation(f.contract, f.signer, f.escrowId, "PKG-OTHER");
    await expect(f.contract.release(f.escrowId, wrongShipment.schemaVersion, wrongShipment.attestationId, wrongShipment.evidenceHash, wrongShipment.sourceId, wrongShipment.issuedAt, wrongShipment.expiresAt, wrongShipment.nonce, wrongShipment.outcome, wrongShipment.signature))
      .to.emit(f.contract, "AttestationRejected").withArgs(f.escrowId, 6);
    const expired = await signedAttestation(f.contract, f.signer, f.escrowId, f.shipmentId, { issuedAt: latest.timestamp - 120, expiresAt: latest.timestamp - 1 });
    await expect(f.contract.release(f.escrowId, expired.schemaVersion, expired.attestationId, expired.evidenceHash, expired.sourceId, expired.issuedAt, expired.expiresAt, expired.nonce, expired.outcome, expired.signature))
      .to.emit(f.contract, "AttestationRejected").withArgs(f.escrowId, 3);
    const negative = await signedAttestation(f.contract, f.signer, f.escrowId, f.shipmentId, { outcome: 0 });
    await expect(f.contract.release(f.escrowId, negative.schemaVersion, negative.attestationId, negative.evidenceHash, negative.sourceId, negative.issuedAt, negative.expiresAt, negative.nonce, negative.outcome, negative.signature))
      .to.emit(f.contract, "AttestationRejected").withArgs(f.escrowId, 2);
  });

  it("allows bounded backend/node clock skew and rejects excessive future issue times", async function () {
    const accepted = await fixture();
    const latest = await ethers.provider.getBlock("latest");
    const slightlyFuture = await signedAttestation(accepted.contract, accepted.signer, accepted.escrowId, accepted.shipmentId, {
      issuedAt: latest.timestamp + 30,
      expiresAt: latest.timestamp + 630
    });
    await expect(accepted.contract.release(accepted.escrowId, slightlyFuture.schemaVersion, slightlyFuture.attestationId, slightlyFuture.evidenceHash, slightlyFuture.sourceId, slightlyFuture.issuedAt, slightlyFuture.expiresAt, slightlyFuture.nonce, slightlyFuture.outcome, slightlyFuture.signature))
      .to.emit(accepted.contract, "EscrowReleased");

    const rejected = await fixture();
    const newest = await ethers.provider.getBlock("latest");
    const tooFuture = await signedAttestation(rejected.contract, rejected.signer, rejected.escrowId, rejected.shipmentId, {
      issuedAt: newest.timestamp + 90,
      expiresAt: newest.timestamp + 690
    });
    await expect(rejected.contract.release(rejected.escrowId, tooFuture.schemaVersion, tooFuture.attestationId, tooFuture.evidenceHash, tooFuture.sourceId, tooFuture.issuedAt, tooFuture.expiresAt, tooFuture.nonce, tooFuture.outcome, tooFuture.signature))
      .to.emit(rejected.contract, "AttestationRejected").withArgs(rejected.escrowId, 4);
  });

  it("blocks replay and double release", async function () {
    const f = await fixture();
    const attestation = await signedAttestation(f.contract, f.signer, f.escrowId, f.shipmentId);
    const args = [f.escrowId, attestation.schemaVersion, attestation.attestationId, attestation.evidenceHash, attestation.sourceId, attestation.issuedAt, attestation.expiresAt, attestation.nonce, attestation.outcome, attestation.signature];
    await f.contract.release(...args);
    await expect(f.contract.release(...args)).to.emit(f.contract, "AttestationRejected").withArgs(f.escrowId, 1);
    expect(await f.contract.usedNonces(attestation.nonce)).to.equal(true);
  });

  it("rejects an unauthorized signer update", async function () {
    const f = await fixture();
    await expect(f.contract.connect(f.buyer).setAuthorizedSigner(f.buyer.address)).to.be.reverted;
  });
});