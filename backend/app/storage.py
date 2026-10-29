import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from app.schemas import EvidenceRecord


class EvidenceStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS evidence (record_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, outcome TEXT, payload TEXT NOT NULL, evidence_content TEXT NOT NULL, history TEXT NOT NULL)"
            )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    def save(self, record: EvidenceRecord, evidence_content: str, event: str) -> None:
        with self._connect() as connection:
            existing = connection.execute("SELECT history FROM evidence WHERE record_id=?", (record.record_id,)).fetchone()
            history = json.loads(existing["history"]) if existing else []
            history.append({"at": datetime.now(UTC).isoformat(), "event": event})
            connection.execute(
                "INSERT INTO evidence(record_id, created_at, outcome, payload, evidence_content, history) VALUES(?,?,?,?,?,?) "
                "ON CONFLICT(record_id) DO UPDATE SET outcome=excluded.outcome, payload=excluded.payload, evidence_content=excluded.evidence_content, history=excluded.history",
                (
                    record.record_id,
                    record.created_at.isoformat(),
                    record.verification.outcome.value if record.verification else None,
                    record.model_dump_json(),
                    evidence_content,
                    json.dumps(history),
                ),
            )

    def get(self, record_id: str) -> dict[str, object] | None:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM evidence WHERE record_id=?", (record_id,)).fetchone()
        if row is None:
            return None
        return {
            "record": json.loads(row["payload"]),
            "evidence_content": row["evidence_content"],
            "history": json.loads(row["history"]),
        }

    def list_recent(self, limit: int = 50) -> list[dict[str, object]]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT payload FROM evidence ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return [json.loads(row["payload"]) for row in rows]

    def stats(self) -> dict[str, int]:
        counts = {"analyzed": 0, "verified": 0, "not_verified": 0, "review_required": 0}
        with self._connect() as connection:
            rows = connection.execute("SELECT outcome, COUNT(*) AS count FROM evidence GROUP BY outcome").fetchall()
        for row in rows:
            counts["analyzed"] += row["count"]
            if row["outcome"] == "VERIFIED_DELIVERED":
                counts["verified"] = row["count"]
            elif row["outcome"] == "NOT_VERIFIED":
                counts["not_verified"] = row["count"]
            elif row["outcome"] == "REVIEW_REQUIRED":
                counts["review_required"] = row["count"]
        return counts