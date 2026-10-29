from datetime import UTC, datetime
import re
from urllib.parse import urlsplit

from app.schemas import (
    DeliveryStatus,
    EvidenceExtraction,
    EvidenceRequest,
    VerificationOutcome,
    VerificationResult,
)


def verify_delivery(
    request: EvidenceRequest,
    extraction: EvidenceExtraction,
    *,
    authorized_hosts: set[str],
    evidence_content: str,
    suspicious_content: bool = False,
    now: datetime | None = None,
) -> VerificationResult:
    checked_at = now or datetime.now(UTC)
    warnings: list[str] = []
    source_host = (urlsplit(str(extraction.source_url)).hostname or "").lower().rstrip(".")
    requested_host = (urlsplit(str(request.tracking_url)).hostname or "").lower().rstrip(".")
    source_authorized = source_host in {host.lower().rstrip(".") for host in authorized_hosts}
    source_matches_request = source_host == requested_host
    shipment_matches = extraction.shipment_id == request.shipment_id
    shipment_grounded = extraction.shipment_id is not None and re.search(
        rf"(?<![A-Za-z0-9._-]){re.escape(extraction.shipment_id)}(?![A-Za-z0-9._-])",
        evidence_content,
        re.IGNORECASE,
    ) is not None
    delivered = extraction.delivery_status == DeliveryStatus.DELIVERED
    timestamp_forms: set[str] = set()
    if extraction.delivery_timestamp is not None:
        normalized_timestamp = extraction.delivery_timestamp.isoformat()
        timestamp_forms = {normalized_timestamp, normalized_timestamp.replace("+00:00", "Z")}
    timestamp_grounded = (
        not delivered and extraction.delivery_timestamp is None
    ) or any(stamp.casefold() in evidence_content.casefold() for stamp in timestamp_forms)
    quote_grounded = extraction.supporting_evidence.strip().casefold() in evidence_content.casefold()
    declared_statuses = {
        status.upper()
        for status in re.findall(
            r"(?i)[\"']?(?:delivery[_ ]status|status)[\"']?\s*:\s*[\"']?(DELIVERED|IN_TRANSIT|EXCEPTION|NOT_FOUND|UNKNOWN)\b",
            evidence_content,
        )
    }
    status_grounded = extraction.delivery_status.value in declared_statuses
    conflicting_statuses = len(declared_statuses) > 1
    timestamp_present_valid = (
        extraction.delivery_timestamp is not None
        and extraction.delivery_timestamp.tzinfo is not None
        and extraction.delivery_timestamp <= checked_at
    )
    timestamp_valid = timestamp_present_valid if delivered else (
        extraction.delivery_timestamp is None or timestamp_present_valid
    )

    if suspicious_content:
        warnings.append("Instruction-like content was detected in untrusted source text; manual review is required.")
    if not source_authorized:
        warnings.append("The evidence source is not on the configured authorization list.")
    if not source_matches_request:
        warnings.append("The extracted evidence source does not match the requested tracking host.")
    if extraction.shipment_id is None:
        warnings.append("The source did not provide a shipment identifier.")
    elif not shipment_matches:
        warnings.append("The source shipment identifier does not match the requested shipment.")
    if not shipment_grounded or not status_grounded or not timestamp_grounded or not quote_grounded:
        warnings.append("One or more extracted fields are not directly grounded in the retrieved evidence bytes.")
    if conflicting_statuses:
        warnings.append("The retrieved evidence contains conflicting explicit delivery statuses.")
    if delivered and not timestamp_valid:
        warnings.append("A valid, non-future delivery timestamp is required.")
    elif extraction.delivery_timestamp is not None and not timestamp_valid:
        warnings.append("The source timestamp is invalid or in the future.")
    if extraction.delivery_status == DeliveryStatus.UNKNOWN:
        warnings.append("The source did not establish a recognized delivery state.")

    checks = {
        "source_authorized": source_authorized,
        "source_matches_request": source_matches_request,
        "shipment_matches": shipment_matches,
        "shipment_grounded": shipment_grounded,
        "status_grounded": status_grounded,
        "timestamp_grounded": timestamp_grounded,
        "supporting_evidence_grounded": quote_grounded,
        "no_conflicting_statuses": not conflicting_statuses,
        "delivered_status": delivered,
        "timestamp_valid": timestamp_valid,
        "injection_scan_clear": not suspicious_content,
    }

    if (
        suspicious_content
        or not source_authorized
        or not source_matches_request
        or extraction.shipment_id is None
        or not shipment_matches
        or not timestamp_valid
        or extraction.delivery_status == DeliveryStatus.UNKNOWN
        or conflicting_statuses
        or not shipment_grounded
        or not status_grounded
        or not timestamp_grounded
        or not quote_grounded
    ):
        outcome = VerificationOutcome.REVIEW_REQUIRED
    elif not delivered:
        outcome = VerificationOutcome.NOT_VERIFIED
    else:
        outcome = VerificationOutcome.VERIFIED_DELIVERED

    return VerificationResult(outcome=outcome, checks=checks, warnings=warnings, verified_at=checked_at)