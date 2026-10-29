from pathlib import Path

from eth_account import Account


def main() -> None:
    account = Account.create()
    env_path = Path(__file__).resolve().parents[1] / ".env"
    existing = env_path.read_text(encoding="utf-8").splitlines() if env_path.exists() else []
    values = {
        "ATTESTATION_PRIVATE_KEY": account.key.hex(),
        "ATTESTATION_SIGNER_ADDRESS": account.address,
    }
    updated = []
    seen = set()
    for line in existing:
        key = line.partition("=")[0]
        if key in values:
            updated.append(f"{key}={values[key]}")
            seen.add(key)
        else:
            updated.append(line)
    updated.extend(f"{key}={value}" for key, value in values.items() if key not in seen)
    env_path.write_text("\n".join(updated) + "\n", encoding="utf-8")
    print("Generated local development signer. Private key stored only in backend/.env; do not use with real funds.")
    print(f"ATTESTATION_SIGNER_ADDRESS={account.address}")


if __name__ == "__main__":
    main()