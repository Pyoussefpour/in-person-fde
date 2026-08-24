# Voice Agent Starter

This repository intentionally contains only the starting point for the AI
Receptionist assignment: a small browser voice agent using Phonic for a natural,
hands-free conversation.

It does **not** include receptionist logic, lawyers, matters, conflict checking,
calendars, a database, or a dashboard. Those are the assignment.

## Setup

You need Python 3.11+ and a Phonic API key.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
# Add PHONIC_API_KEY to .env
```

## Run the agent

```bash
voice-agent
```

Open <http://127.0.0.1:8000>, choose a microphone, and allow microphone access.
Press the green call button and speak naturally. The input meter shows whether
the browser is receiving your voice. The Realtime model detects turns
automatically, speaks back, and can be interrupted. Press the red button to
hang up.

The permanent Phonic API key stays on the backend. The browser receives only a
short-lived session token for each call.

## Customize it

The main extension points are:

- Change `prompts/agent.txt` to give the agent a role and behaviour.
- Change `PHONIC_MODEL` and `PHONIC_VOICE` to customize Phonic.

Prompt and configuration changes take effect on the next call.

## Project map

```text
prompts/agent.txt          editable system prompt
voice_agent/config.py      model and voice configuration
voice_agent/web.py         web server and Phonic session endpoint
web/                       basic call interface
tests/                     tests that do not call the API
```

Run the tests with:

```bash
pytest
```

Keep API keys, recordings, and real client information out of Git.
