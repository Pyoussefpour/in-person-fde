from dataclasses import dataclass
import os
from pathlib import Path

from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")


@dataclass(frozen=True)
class Settings:
    phonic_api_key: str
    phonic_model: str
    phonic_voice: str
    prompt_path: Path

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            phonic_api_key=os.getenv("PHONIC_API_KEY", ""),
            phonic_model=os.getenv("PHONIC_MODEL", "merritt"),
            phonic_voice=os.getenv("PHONIC_VOICE", "sabrina"),
            prompt_path=PROJECT_ROOT / "prompts" / "agent.txt",
        )

    def require_phonic_api_key(self) -> None:
        if (
            not self.phonic_api_key
            or self.phonic_api_key == "your_phonic_api_key_here"
        ):
            raise RuntimeError(
                "PHONIC_API_KEY is missing. Add a Phonic API key to .env."
            )

    def load_prompt(self) -> str:
        return self.prompt_path.read_text(encoding="utf-8").strip()
