import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


load_dotenv(Path(__file__).resolve().parents[1] / ".env")


@dataclass(frozen=True)
class Settings:
    demo_mode: bool = os.getenv("DEMO_MODE", "true").lower() == "true"
    tinyfish_api_key: str | None = os.getenv("TINYFISH_API_KEY")
    openai_api_key: str | None = os.getenv("OPENAI_API_KEY")
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    llm_provider: str = os.getenv("LLM_PROVIDER", "openai").lower()
    attestation_private_key: str | None = os.getenv("ATTESTATION_PRIVATE_KEY")
    chain_id: int = int(os.getenv("CHAIN_ID", "31337"))
    contract_address: str = os.getenv("ESCROW_CONTRACT_ADDRESS", "")
    database_path: Path = Path(os.getenv("DATABASE_PATH", str(Path(__file__).resolve().parents[1] / "data" / "proofbridge.sqlite3")))
    authorized_hosts: frozenset[str] = frozenset(
        host.strip().lower().rstrip(".")
        for host in os.getenv("AUTHORIZED_TRACKING_HOSTS", "tracking.example").split(",")
        if host.strip()
    )


settings = Settings()