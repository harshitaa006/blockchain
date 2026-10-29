from dataclasses import replace

import httpx
import pytest

from app.tinyfish_client import RetrievalError, TinyFishClient


@pytest.mark.asyncio
async def test_tinyfish_request_uses_documented_endpoint_auth_and_parses_result(monkeypatch) -> None:
    import app.tinyfish_client as module

    monkeypatch.setattr(module, "settings", replace(module.settings, authorized_hosts=frozenset({"tracking.example"})))
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"run_id": "run-1", "status": "COMPLETED", "result": {"tracking": "Delivered"}})

    result = await TinyFishClient(api_key="test-key", transport=httpx.MockTransport(handler)).retrieve(
        "https://tracking.example/PKG-7821"
    )
    assert requests[0].url == "https://agent.tinyfish.ai/v1/automation/run"
    assert requests[0].headers["X-API-Key"] == "test-key"
    assert result.retrieval_id == "run-1"
    assert '"tracking": "Delivered"' in result.content


@pytest.mark.asyncio
async def test_tinyfish_fails_closed_for_non_success_response(monkeypatch) -> None:
    import app.tinyfish_client as module

    monkeypatch.setattr(module, "settings", replace(module.settings, authorized_hosts=frozenset({"tracking.example"})))
    client = TinyFishClient(api_key="test-key", transport=httpx.MockTransport(lambda request: httpx.Response(503)))
    with pytest.raises(RetrievalError, match="HTTP 503"):
        await client.retrieve("https://tracking.example/PKG-7821")