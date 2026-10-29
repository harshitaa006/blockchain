from dataclasses import replace

from fastapi.testclient import TestClient

from app import main
from app.storage import EvidenceStore


def test_demo_api_runs_full_evidence_pipeline_and_stores_history(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(main, "settings", replace(main.settings, demo_mode=True))
    monkeypatch.setattr(main, "store", EvidenceStore(tmp_path / "evidence.sqlite3"))
    client = TestClient(main.app)

    response = client.post(
        "/api/evidence/analyze",
        json={
            "shipment_id": "PKG-7821",
            "tracking_url": "https://tracking.example/PKG-7821",
            "escrow_id": "0x" + "11" * 32,
        },
    )

    assert response.status_code == 200
    result = response.json()
    assert result["record"]["retrieval_mode"] == "demo_simulated"
    assert result["record"]["verification"]["outcome"] == "VERIFIED_DELIVERED"
    assert "DEMO MODE" in result["evidence_content"]
    detail = client.get(f"/api/evidence/{result['record']['record_id']}")
    assert detail.status_code == 200
    assert detail.json()["history"][0]["event"] == "evidence_analyzed"


def test_api_rejects_unauthorized_source(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(main, "settings", replace(main.settings, demo_mode=True))
    monkeypatch.setattr(main, "store", EvidenceStore(tmp_path / "evidence.sqlite3"))
    response = TestClient(main.app).post(
        "/api/evidence/analyze",
        json={"shipment_id": "PKG-7821", "tracking_url": "https://attacker.example/track"},
    )
    assert response.status_code == 422


def test_health_does_not_expose_secrets(monkeypatch) -> None:
    monkeypatch.setattr(main, "settings", replace(main.settings, tinyfish_api_key="not-for-response"))
    response = TestClient(main.app).get("/api/health")
    assert response.status_code == 200
    assert "not-for-response" not in response.text
