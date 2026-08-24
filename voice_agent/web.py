from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import httpx
import uvicorn

from voice_agent.config import PROJECT_ROOT, Settings


STATIC_DIR = PROJECT_ROOT / "web"
app = FastAPI(title="Voice Agent Starter")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/config")
def public_config() -> dict[str, str | bool]:
    settings = Settings.from_env()
    return {
        "model": settings.phonic_model,
        "voice": settings.phonic_voice,
        "configured": settings.phonic_api_key
        not in {"", "your_phonic_api_key_here"},
    }


@app.post("/api/session")
async def create_session() -> JSONResponse:
    """Mint a short-lived token so the browser never receives the Phonic API key."""
    settings = Settings.from_env()
    try:
        settings.require_phonic_api_key()
    except RuntimeError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    async with httpx.AsyncClient(timeout=30) as client:
        phonic_response = await client.post(
            "https://api.phonic.ai/v1/auth/session_token",
            headers={"Authorization": f"Bearer {settings.phonic_api_key}"},
            json={"ttl_seconds": 300},
        )

    if not phonic_response.is_success:
        return JSONResponse(
            content={"detail": phonic_response.text},
            status_code=phonic_response.status_code,
        )

    token_data = phonic_response.json()
    return JSONResponse(
        content={
            "session_token": token_data["session_token"],
            "config": {
                "type": "config",
                "model": settings.phonic_model,
                "system_prompt": settings.load_prompt(),
                "voice_id": settings.phonic_voice,
                "input_format": "pcm_24000",
                "output_format": "pcm_24000",
                "push_to_talk": False,
                "generate_welcome_message": True,
                "vad_threshold": 0.3,
            },
        }
    )


def main() -> None:
    uvicorn.run("voice_agent.web:app", host="127.0.0.1", port=8000, reload=True)
