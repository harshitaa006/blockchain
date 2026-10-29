from datetime import datetime
from enum import StrEnum
from typing import Annotated

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field


ShipmentId = Annotated[str, Field(min_length=2, max_length=64, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")]


class DeliveryStatus(StrEnum):
    DELIVERED = "DELIVERED"
    IN_TRANSIT = "IN_TRANSIT"
    EXCEPTION = "EXCEPTION"
    NOT_FOUND = "NOT_FOUND"
    UNKNOWN = "UNKNOWN"


class VerificationOutcome(StrEnum):
    VERIFIED_DELIVERED = "VERIFIED_DELIVERED"
    NOT_VERIFIED = "NOT_VERIFIED"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"


class EvidenceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    shipment_id: ShipmentId
    tracking_url: AnyHttpUrl
    escrow_id: str | None = Field(default=None, pattern=r"^0x[0-9a-fA-F]{64}$")


class EvidenceExtraction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    shipment_id: ShipmentId | None = None
    delivery_status: DeliveryStatus
    delivery_timestamp: datetime | None = None
    source_url: AnyHttpUrl
    supporting_evidence: str = Field(min_length=1, max_length=2000)
    confidence: float | None = Field(default=None, ge=0, le=1)


class VerificationResult(BaseModel):
    outcome: VerificationOutcome
    checks: dict[str, bool]
    warnings: list[str] = Field(default_factory=list)
    verified_at: datetime


class EvidenceRecord(BaseModel):
    record_id: str
    request: EvidenceRequest
    extraction: EvidenceExtraction | None = None
    evidence_hash: str | None = None
    retrieval_mode: str
    retrieval_metadata: dict[str, str] = Field(default_factory=dict)
    suspicious_content_detected: bool = False
    verification: VerificationResult | None = None
    attestation: "Attestation | None" = None
    created_at: datetime


class Attestation(BaseModel):
    schema_version: str = "1"
    attestation_id: str
    escrow_id: str
    shipment_id: ShipmentId
    outcome: VerificationOutcome
    evidence_hash: str
    source_id: str
    issued_at: int
    expires_at: int
    nonce: str
    chain_id: int
    contract_address: str
    signer_address: str
    signature: str
