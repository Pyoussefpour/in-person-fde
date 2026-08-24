import json

from voice_agent.config import PROJECT_ROOT


def load_json(name: str) -> dict:
    return json.loads((PROJECT_ROOT / "data" / name).read_text(encoding="utf-8"))


def test_client_and_lawyer_cases_match() -> None:
    clients = load_json("clients.json")["clients"]
    lawyers = load_json("lawyers.json")["lawyers"]

    client_cases = {
        case["case_id"]: {
            "title": case["title"],
            "description": case["description"],
            "status": case["status"],
            "client_id": client["client_id"],
            "lawyer_id": case["assigned_lawyer"]["lawyer_id"],
        }
        for client in clients
        for case in client["open_cases"]
    }
    lawyer_cases = {
        case["case_id"]: {
            "title": case["title"],
            "description": case["description"],
            "status": case["status"],
            "client_id": case["client"]["client_id"],
            "lawyer_id": lawyer["lawyer_id"],
        }
        for lawyer in lawyers
        for case in lawyer["assigned_cases"]
    }

    assert client_cases == lawyer_cases


def test_all_people_are_fictional_examples() -> None:
    clients = load_json("clients.json")["clients"]
    lawyers = load_json("lawyers.json")["lawyers"]

    assert all(person["email"].endswith("@example.com") for person in clients)
    assert all(person["email"].endswith("@example.com") for person in lawyers)
