import ipaddress
import re
from urllib.parse import urlsplit

from pydantic import AnyHttpUrl


_INSTRUCTION_PATTERNS = (
    re.compile(r"\b(ignore|disregard|override)\b.{0,80}\b(instructions?|rules?|polic(?:y|ies))\b", re.I),
    re.compile(r"\b(reveal|print|expose)\b.{0,50}\b(prompt|secret|api key|private key)\b", re.I),
    re.compile(r"\b(authori[sz]e|release|send)\b.{0,50}\b(payment|funds|escrow)\b", re.I),
)


def detect_instruction_like_content(content: str) -> bool:
    return any(pattern.search(content) for pattern in _INSTRUCTION_PATTERNS)


def validate_public_http_url(url: AnyHttpUrl | str) -> str:
    parsed = urlsplit(str(url))
    hostname = (parsed.hostname or "").rstrip(".").lower()
    if parsed.scheme not in {"http", "https"} or not hostname or parsed.username or parsed.password:
        raise ValueError("Tracking URL must be a public HTTP(S) URL without embedded credentials")
    if hostname == "localhost" or hostname.endswith((".localhost", ".local", ".internal")):
        raise ValueError("Local and internal tracking URLs are not allowed")
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        return hostname
    if not address.is_global:
        raise ValueError("Private and non-public tracking IPs are not allowed")
    return hostname
