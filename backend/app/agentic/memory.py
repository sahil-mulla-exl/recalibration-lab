from __future__ import annotations

from typing import Any, Dict, List

from backend.app.utils.session import get_session, persist_session


class MemoryStore:
    def append_event(self, session_id: str, event: Dict[str, Any]) -> None:
        session = get_session(session_id)
        if not session:
            return
        log: List[Dict[str, Any]] = session.setdefault("agent_memory", [])
        log.append(event)
        persist_session(session_id)

    def snapshot(self, session_id: str) -> Dict[str, Any]:
        session = get_session(session_id) or {}
        return {
            "session_id": session_id,
            "model_entry": session.get("model_entry"),
            "drift_result": session.get("drift_result"),
            "recalibration_result": session.get("recalibration_result"),
            "evaluation_result": session.get("evaluation_result"),
            "agent_memory": list(session.get("agent_memory") or []),
        }
