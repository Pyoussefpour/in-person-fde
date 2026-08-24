from pathlib import Path

from voice_agent.config import Settings


def test_prompt_is_external_and_editable() -> None:
    settings = Settings(
        phonic_api_key="test-phonic-key",
        phonic_model="test-phonic-model",
        phonic_voice="test-phonic-voice",
        prompt_path=Path("prompts/agent.txt"),
    )

    assert "friendly voice assistant" in settings.load_prompt()


def test_model_is_configurable(monkeypatch) -> None:
    monkeypatch.setenv("PHONIC_MODEL", "my-custom-model")

    assert Settings.from_env().phonic_model == "my-custom-model"
