# ProofBridge

AI-assisted real-world evidence verification for a delivery escrow prototype. This is a working local demo, not a trustless oracle: model extraction is untrusted, deterministic checks gate signing, and the EVM contract independently verifies the attestation before moving test ETH.

## What Works

- FastAPI pipeline with SQLite history, explicit demo evidence, TinyFish Agent API retrieval, and optional OpenAI structured extraction.
- Prompt-injection warning, strict schema validation, evidence-byte grounding, source/shipment/timestamp checks, and fail-closed review outcomes.
- SHA-256 evidence fingerprint and ECDSA signed, expiring, escrow-bound attestations.
- OpenZeppelin-based payable Solidity escrow with on-chain signer recovery, replay protection, and local Hardhat tests.
- React dashboard connected to the API, injected wallet, and deployed local contract.
- End-to-end local demo script.

## Requirements

- Python 3.12+
- Node.js 20+ and npm
- MetaMask or another injected EIP-1193 wallet for the browser flow

## Install

From the repository root in PowerShell:

```powershell
py -3.12 -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env
Push-Location contracts
npm install
Pop-Location
Push-Location frontend
npm install
Pop-Location
```

Demo mode requires no TinyFish or LLM credentials. To use live retrieval, set `DEMO_MODE=false`, add your `TINYFISH_API_KEY`, configure `OPENAI_API_KEY`, and replace `AUTHORIZED_TRACKING_HOSTS` with the exact tracking host(s) you explicitly permit. TinyFish uses `POST https://agent.tinyfish.ai/v1/automation/run` with the `X-API-Key` header. The API endpoint and parsing live in `backend/app/tinyfish_client.py`.

## Start the Backend

From the repository root:

```powershell
backend/.venv/Scripts/python.exe -m uvicorn app.main:app --app-dir backend --reload --port 8000
```

Health: `http://localhost:8000/api/health`. API docs: `http://localhost:8000/docs`.

## Start the Dashboard

In a second terminal:

```powershell
Push-Location frontend
npm run dev
```

Open `http://localhost:5173`. The dashboard labels the canned evidence as simulated. The sample only verifies shipment `PKG-7821` at the configured demo host. You can analyze without a wallet, but signing and release require the steps below.

## Local Blockchain and Deployment

1. Generate a development-only attestation signer:

   ```powershell
   backend/.venv/Scripts/python.exe backend/app/setup_dev_key.py
   ```

   The command writes the private key directly to the ignored `backend/.env` and prints only the public address. This key is for local testing only.

2. Start a local Hardhat node in a third terminal:

   ```powershell
   Push-Location contracts
   npm run node
   ```

3. Deploy from another terminal:

   ```powershell
   Push-Location contracts
   npm run deploy:local
   Pop-Location
   ```

   Copy the displayed contract address into `ESCROW_CONTRACT_ADDRESS` in `backend/.env` and `VITE_ESCROW_ADDRESS` in `frontend/.env`. Restart backend and Vite after editing environment files.

4. In MetaMask, add the local network at `http://127.0.0.1:8545`, chain ID `31337`, currency `ETH`. Import a disposable account from the Hardhat node output. Never use a real wallet key.

5. Create escrow from the dashboard, analyze evidence with its escrow ID, sign the eligible record, and submit the attestation. A release only counts as successful after the contract emits `EscrowReleased` in a mined receipt.

## End-to-End Script

With the backend and local Hardhat node running, and the contract address configured in `backend/.env`:

```powershell
Push-Location contracts
npm run demo:local
Pop-Location
```

The script deposits `0.01` local test ETH, submits the sample to the backend, requests a signature only after `VERIFIED_DELIVERED`, and sends the signed attestation to the contract. The output names the evidence mode and transaction result. No external API credential is required in demo mode.

## Tests and Build

```powershell
backend/.venv/Scripts/python.exe -m pytest -q
Push-Location contracts
npm test
Pop-Location
Push-Location frontend
npm run build
Pop-Location
```

## API

- `POST /api/evidence/analyze`: shipment, approved tracking URL, optional bytes32 escrow ID.
- `GET /api/evidence/{id}`: stored record, evidence text, and processing history.
- `GET /api/evidence`: recent records.
- `GET /api/stats`: result counts.
- `POST /api/attestations/{id}/sign`: signs only an eligible, unchanged evidence record.
- `GET /api/health`: status/configuration booleans only; no secrets.

## Limitations

This prototype does not authenticate a carrier's identity or prove an actual delivery. Hashes prove integrity relative to stored bytes; signatures authenticate the attestation signer; neither proves source truth. Prompt injection cannot be eliminated, the detector may miss attacks, and any source can make false claims. The signer is a development hot key. Do not use real funds or deploy to mainnet. See [architecture](docs/architecture.md) and [security model](docs/security-model.md).

The contract development dependency audit currently reports 38 transitive advisories in the Hardhat 2/toolbox development tree. Most available automatic fixes require a major Hardhat/toolbox upgrade; the validated prototype does not apply those upgrades. The direct OpenZeppelin dependency is pinned to patched 5.6.1. Frontend dependencies audit clean.