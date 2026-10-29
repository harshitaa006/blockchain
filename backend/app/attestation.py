import json
import secrets
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from urllib.parse import urlsplit
from uuid import uuid4

from eth_abi import encode
from eth_account import Account
from eth_account.messages import encode_defunct
from eth_utils import keccak

from app.schemas import Attestation, EvidenceRecord, VerificationOutcome


def canonical_json(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def fingerprint_evidence(source_url: str, content: str) -> str:
    return "0x" + sha256(canonical_json({"content": content, "source_url": source_url})).hexdigest()


def verify_evidence_fingerprint(source_url: str, content: str, expected_hash: str) -> bool:
    return secrets.compare_digest(fingerprint_evidence(source_url, content), expected_hash)


def build_contract_digest(attestation: Attestation) -> bytes:
    source_host = (urlsplit(attestation.source_id).hostname or attestation.source_id).lower().rstrip(".")
    source_hash = keccak(text=source_host)
    status = 1 if attestation.outcome == VerificationOutcome.VERIFIED_DELIVERED else 0
    encoded = encode(
        ["uint256", "address", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32", "uint64", "uint64", "bytes32", "uint8"],
        [
            attestation.chain_id,
            attestation.contract_address,
            keccak(text=attestation.schema_version),
            keccak(text=attestation.attestation_id),
            bytes.fromhex(attestation.escrow_id[2:]),
            keccak(text=attestation.shipment_id),
            bytes.fromhex(attestation.evidence_hash[2:]),
            source_hash,
            attestation.issued_at,
            attestation.expires_at,
            bytes.fromhex(attestation.nonce[2:]),
            status,
        ],
    )
    return keccak(encoded)


def issue_attestation(
    record: EvidenceRecord,
    evidence_content: str,
    *,
    private_key: str,
    chain_id: int,
    contract_address: str,
    now: datetime | None = None,
    lifetime: timedelta = timedelta(minutes=15),
) -> Attestation:
    if record.verification is None or record.verification.outcome != VerificationOutcome.VERIFIED_DELIVERED:
        raise ValueError("Only verified delivery records can be attested")
    if not record.request.escrow_id or not record.evidence_hash or record.extraction is None:
        raise ValueError("The record is not bound to an escrow and evidence")
    if not verify_evidence_fingerprint(str(record.extraction.source_url), evidence_content, record.evidence_hash):
        raise ValueError("Evidence changed since verification")
    issued = now or datetime.now(UTC)
    expires = issued + lifetime
    account = Account.from_key(private_key)
    values = {
        "schema_version": "1",
        "attestation_id": str(uuid4()),
        "escrow_id": record.request.escrow_id,
        "shipment_id": record.request.shipment_id,
        "outcome": VerificationOutcome.VERIFIED_DELIVERED,
        "evidence_hash": record.evidence_hash,
        "source_id": (urlsplit(str(record.extraction.source_url)).hostname or "").lower().rstrip("."),
        "issued_at": int(issued.timestamp()),
        "expires_at": int(expires.timestamp()),
        "nonce": "0x" + secrets.token_hex(32),
        "chain_id": chain_id,
        "contract_address": contract_address,
        "signer_address": account.address,
        "signature": "",
    }
    unsigned = Attestation(**values)
    signature = Account.sign_message(encode_defunct(primitive=build_contract_digest(unsigned)), private_key=private_key).signature.hex()
    values["signature"] = signature if signature.startswith("0x") else "0x" + signature
    return Attestation(**values)


def verify_attestation_signature(attestation: Attestation) -> bool:
    try:
        recovered = Account.recover_message(
            encode_defunct(primitive=build_contract_digest(attestation)), signature=attestation.signature
        )
    except (ValueError, TypeError):
        return False
    return recovered.lower() == attestation.signer_address.lower()


def attestation_is_current(attestation: Attestation, now: datetime | None = None) -> bool:
    current_time = int((now or datetime.now(UTC)).timestamp())
    return attestation.issued_at <= current_time < attestation.expires_at