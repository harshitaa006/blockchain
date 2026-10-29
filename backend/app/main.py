from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.attestation import fingerprint_evidence, issue_attestation, verify_attestation_signature
from app.config import settings
from app.interpreter import InterpretationError, get_interpreter
from app.schemas import Attestation, EvidenceRecord, EvidenceRequest
from app.security import detect_instruction_like_content, validate_public_http_url
from app.storage import EvidenceStore
from app.tinyfish_client import RetrievedEvidence, RetrievalError, TinyFishClient
from app.verifier import verify_delivery


app = FastAPI(title="ProofBridge API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)
store = EvidenceStore(settings.database_path)
sample_evidence_path = Path(__file__).resolve().parent / "demo_evidence.txt"


@app.get("/api/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "retrieval_mode": "demo" if settings.demo_mode else "tinyfish",
        "ai_configured": bool(settings.openai_api_key),
        "signing_configured": bool(settings.attestation_private_key and settings.contract_address),
    }


@app.get("/api/stats")
def stats() -> dict[str, int]:
    return store.stats()


@app.get("/api/evidence")
def list_evidence() -> list[dict[str, object]]:
    return store.list_recent()


@app.post("/api/evidence/analyze")
async def analyze_evidence(request: EvidenceRequest) -> dict[str, object]:
    try:
        requested_host = validate_public_http_url(request.tracking_url)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if requested_host not in settings.authorized_hosts:
        raise HTTPException(status_code=422, detail="Tracking source is not authorized for this use case.")

    if settings.demo_mode:
        if not sample_evidence_path.exists():
            raise HTTPException(status_code=503, detail="The labeled demo evidence sample is unavailable.")
        evidence = RetrievedEvidence(
            source_url=str(request.tracking_url),
            content=sample_evidence_path.read_text(encoding="utf-8"),
            mode="demo_simulated",
        )
    else:
        try:
            evidence = await TinyFishClient().retrieve(str(request.tracking_url))
        except RetrievalError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    suspicious = detect_instruction_like_content(evidence.content)
    try:
        extraction = await get_interpreter(demo=settings.demo_mode).interpret(evidence)
    except InterpretationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    verification = verify_delivery(
        request,
        extraction,
        authorized_hosts=set(settings.authorized_hosts),
        evidence_content=evidence.content,
        suspicious_content=suspicious,
    )
    record = EvidenceRecord(
        record_id=str(uuid4()),
        request=request,
        extraction=extraction,
        evidence_hash=fingerprint_evidence(evidence.source_url, evidence.content),
        retrieval_mode=evidence.mode,
        retrieval_metadata={
            "source_host": urlsplit(evidence.source_url).hostname or "",
            "retrieval_id": "none" if evidence.retrieval_id is None else evidence.retrieval_id,
        },
        suspicious_content_detected=suspicious,
        verification=verification,
        created_at=datetime.now(UTC),
    )
    store.save(record, evidence.content, "evidence_analyzed")
    return {"record": record.model_dump(mode="json"), "evidence_content": evidence.content}


@app.get("/api/evidence/{record_id}")
def get_evidence(record_id: str) -> dict[str, object]:
    stored = store.get(record_id)
    if stored is None:
        raise HTTPException(status_code=404, detail="Evidence record not found.")
    return stored


@app.post("/api/attestations/{record_id}/sign")
def sign_attestation(record_id: str) -> dict[str, object]:
    if not settings.attestation_private_key or not settings.contract_address:
        raise HTTPException(status_code=503, detail="Attestation signing is not configured.")
    stored = store.get(record_id)
    if stored is None:
        raise HTTPException(status_code=404, detail="Evidence record not found.")
    record = EvidenceRecord.model_validate(stored["record"])
    try:
        attestation = issue_attestation(
            record,
            str(stored["evidence_content"]),
            private_key=settings.attestation_private_key,
            chain_id=settings.chain_id,
            contract_address=settings.contract_address,
        )
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not verify_attestation_signature(attestation):
        raise HTTPException(status_code=500, detail="Generated attestation signature failed verification.")
    record.attestation = attestation
    store.save(record, str(stored["evidence_content"]), "attestation_signed")
    return {"attestation": attestation.model_dump(mode="json"), "signature_verified": True}
