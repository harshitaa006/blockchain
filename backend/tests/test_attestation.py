from datetime import UTC, datetime, timedelta

from eth_account import Account

from app.attestation import (
    attestation_is_current,
    fingerprint_evidence,
    issue_attestation,
    verify_attestation_signature,
    verify_evidence_fingerprint,
)
from app.schemas import EvidenceRecord, EvidenceRequest, EvidenceExtraction, VerificationOutcome, VerificationResult


NOW = datetime(2026, 10, 29, 12, 0, tzinfo=UTC)
CONTENT = "Shipment ID: PKG-7821\nStatus: DELIVERED\nDelivered at: 2026-10-28T14:32:00Z"


def make_record(content: str = CONTENT) -> EvidenceRecord:
    request = EvidenceRequest(
        shipment_id="PKG-7821",
        tracking_url="https://tracking.example/PKG-7821",
        escrow_id="0x" + "11" * 32,
    )
    extraction = EvidenceExtraction(
        shipment_id="PKG-7821",
        delivery_status="DELIVERED",
        delivery_timestamp="2026-10-28T14:32:00Z",
        source_url="https://tracking.example/PKG-7821",
        supporting_evidence="Delivered",
    )
    return EvidenceRecord(
        record_id="test-record",
        request=request,
        extraction=extraction,
        evidence_hash=fingerprint_evidence(str(extraction.source_url), content),
        retrieval_mode="demo_simulated",
        verification=VerificationResult(
            outcome=VerificationOutcome.VERIFIED_DELIVERED,
            checks={},
            verified_at=NOW,
        ),
        created_at=NOW,
    )


def test_attestation_signature_and_evidence_hash_verification() -> None:
    account = Account.create()
    record = make_record()
    attestation = issue_attestation(
        record,
        CONTENT,
        private_key=account.key.hex(),
        chain_id=31337,
        contract_address="0x" + "22" * 20,
        now=NOW,
    )
    assert verify_attestation_signature(attestation)
    assert verify_evidence_fingerprint(str(record.extraction.source_url), CONTENT, record.evidence_hash or "")
    assert not verify_evidence_fingerprint(str(record.extraction.source_url), CONTENT + " changed", record.evidence_hash or "")
    assert attestation_is_current(attestation, NOW + timedelta(minutes=1))


def test_modified_attestation_and_different_key_fail_verification() -> None:
    first = Account.create()
    second = Account.create()
    attestation = issue_attestation(
        make_record(), CONTENT, private_key=first.key.hex(), chain_id=31337,
        contract_address="0x" + "22" * 20, now=NOW,
    )
    assert not verify_attestation_signature(attestation.model_copy(update={"shipment_id": "PKG-0000"}))
    assert not verify_attestation_signature(attestation.model_copy(update={"signer_address": second.address}))


def test_expired_attestation_is_not_current() -> None:
    account = Account.create()
    attestation = issue_attestation(
        make_record(), CONTENT, private_key=account.key.hex(), chain_id=31337,
        contract_address="0x" + "22" * 20, now=NOW,
    )
    assert not attestation_is_current(attestation, NOW + timedelta(minutes=16))


def test_changed_evidence_refuses_signing() -> None:
    account = Account.create()
    import pytest

    with pytest.raises(ValueError, match="Evidence changed"):
        issue_attestation(
            make_record(), CONTENT + " edited", private_key=account.key.hex(), chain_id=31337,
            contract_address="0x" + "22" * 20, now=NOW,
        )