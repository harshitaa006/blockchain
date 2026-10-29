const { ethers } = require("hardhat");

async function main() {
  const signerAddress = process.env.ATTESTATION_SIGNER_ADDRESS;
  if (!signerAddress || !ethers.isAddress(signerAddress)) {
    throw new Error("Set ATTESTATION_SIGNER_ADDRESS in backend/.env before deploying.");
  }
  const factory = await ethers.getContractFactory("ProofBridgeEscrow");
  const contract = await factory.deploy(signerAddress);
  await contract.waitForDeployment();
  console.log(`ProofBridgeEscrow: ${await contract.getAddress()}`);
  console.log(`Authorized signer: ${signerAddress}`);
  console.log(`Chain ID: ${(await ethers.provider.getNetwork()).chainId}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});