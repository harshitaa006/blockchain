# Security Model

## Safety Properties

- Only HTTP(S) URLs without embedded credentials and with a public hostname/IP are accepted. Tracking hosts must be explicitly configured.
- The extraction schema forbids extra fields and limits status values. Missing IDs and timestamps remain missing; the interpreter does not synthesize them.
- The verifier returns `VERIFIED_DELIVERED` only when the source is authorized and bound to the request, shipment/status/timestamp/supporting text are grounded in the original retrieved bytes, the shipment matches, the status is delivered, the delivery timestamp is timezone-aware and non-future, and no known suspicious/conflicting content exists.
- Ambiguous, conflicting, suspicious, incomplete, ungrounded, or malformed evidence fails closed to manual review. Valid explicit non-delivery status yields `NOT_VERIFIED`; absence of evidence is not treated as proof of non-delivery.
- Signing is unavailable unless an eligible record is bound to an escrow and its stored evidence digest still matches. Secrets are environment-configured, never put in SQLite or sent to the model.
- The contract validates signature, configured signer, expiry, issued time (with at most 60 seconds of backend/node clock skew), maximum lifetime, shipment, chain, contract, escrow, outcome, and one-use nonce. It marks the escrow released before its external value transfer and uses `ReentrancyGuard`.

## Limitations and Residual Risk

- Prompt-injection pattern detection is heuristic and can miss attacks. Safety does not rely on detection alone, but a malicious authorized source can still contain confusing or false facts.
- The prototype has no carrier-specific source authenticity verification, independent second source, human review workflow, dispute process, or production key-management service.
- The sample is synthetic and fixed to `PKG-7821`. Its status is for demonstration only.
- API availability, provider behavior, and model extraction quality are external dependencies when demo mode is disabled. Failures do not authorize a release.
- `AUTHORIZED_TRACKING_HOSTS` is a host-level allowlist. Production deployments should add carrier-specific URL/path policy, DNS rebinding defenses at the outbound network layer, SSRF egress filtering, rate limits, authentication, and abuse monitoring.
- The development signer is a hot key. Do not use real assets; use a hardware-backed or managed signer and independent contract audit before any deployment beyond local/test networks.
- Local storage contains retrieved source text for an audit trail. Production needs retention controls, encryption, access control, and privacy review.