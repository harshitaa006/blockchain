# ProofBridge Architecture

## Request Path

1. The dashboard submits a shipment ID, an approved tracking URL, and an optional bytes32 escrow ID.
2. FastAPI rejects non-public URLs and hosts outside `AUTHORIZED_TRACKING_HOSTS`.
3. In `DEMO_MODE=true`, the pipeline loads the explicitly labeled sample in `backend/app/demo_evidence.txt`. Otherwise, `TinyFishClient` calls the documented synchronous Agent API endpoint and records its run ID.
4. `OpenAIInterpreter` requests a strict JSON schema. The demo parser is deterministic and extracts only explicit sample fields. Neither interpreter receives tools, payment APIs, or signing secrets.
5. The security scanner flags instruction-like content. Regardless of scanner outcome, the deterministic verifier compares each extracted field and supporting statement with the retrieved evidence bytes, validates source/shipment binding, timestamps, status, authorization, and conflicting explicit statuses.
6. SQLite stores the request, extracted fields, source metadata, evidence digest, outcome, and processing history. Private keys are not stored.
7. The signing route accepts only `VERIFIED_DELIVERED`, escrow-bound records whose evidence hash still matches. It creates a 15-minute ECDSA attestation.
8. The dashboard submits the signed attestation to `ProofBridgeEscrow`. Solidity recovers the configured signer and checks chain, contract, escrow, shipment, digest, time window, success outcome, and one-use nonce before transferring test ETH.

## Trust Boundaries

- Retrieved page text and model output are untrusted data. Delimiters and instructions reduce instruction-following risk but do not eliminate prompt injection.
- The model has no tools and cannot call the signer or contract. The deterministic verifier, backend key guard, and contract independently gate a release.
- `tracking.example` and the sample tracking statements are simulated. They are never evidence from an actual carrier.
- TinyFish retrieval reports what its browser agent returned. Retrieval success does not authenticate the website or establish that a real-world delivery happened.
- A SHA-256 digest detects changes relative to the stored bytes. It does not prove that those bytes are truthful.
- The ECDSA signature authenticates the configured attestation signer and bound fields. It does not prove the signer interpreted truthful evidence.
- The local chain and its accounts are disposable test infrastructure. No mainnet deployment or real funds are part of this prototype.

## Attestation Digest

The backend and contract encode the same ABI fields, in order: chain ID, contract address, schema-version hash, attestation-ID hash, escrow ID, shipment-ID hash, evidence SHA-256, source-host hash, issue time, expiry, nonce, and success outcome. The encoded bytes are Keccak-256 hashed and signed with the EIP-191 personal-message prefix. Solidity verifies the recovered ECDSA address against the owner-configured signer.