import asyncio
from pathlib import Path

from fastapi import HTTPException
import pytest

from voice_agent.web import create_session, index, public_config


def test_frontend_loads() -> None:
    response = index()
    page = Path(response.path).read_text(encoding="utf-8")

    assert "Voice Agent" in page
    assert 'id="audio-input"' in page


def test_public_config_does_not_expose_api_key() -> None:
    config = public_config()

    assert config["model"]
    assert "api_key" not in config


def test_phonic_setup_error_is_clear(monkeypatch) -> None:
    monkeypatch.delenv("PHONIC_API_KEY", raising=False)

    with pytest.raises(HTTPException) as error:
        asyncio.run(create_session())

    assert error.value.status_code == 400
    assert error.value.detail.startswith("PHONIC_API_KEY is missing")
