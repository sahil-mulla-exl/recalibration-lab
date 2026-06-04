import json
import os
import sqlite3
import tempfile
import threading
import uuid
from typing import Any, Dict, Optional

_sessions: Dict[str, Dict[str, Any]] = {}
_lock = threading.RLock()
_db_path = os.path.join(tempfile.gettempdir(), "recalibration_lab_sessions.sqlite3")


def _init_db() -> None:
    with sqlite3.connect(_db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.commit()


_init_db()


def create_session() -> str:
    session_id = str(uuid.uuid4())
    payload = {
        "session_id": session_id,
        "model_id": None,
        "model_entry": None,
        "dev_window": None,
        "eval_window": None,
        "oot_pct": 0.2,
        # loaded dataframes stored as paths
        "dev_data_path": None,
        "new_data_path": None,
        "hold_data_path": None,
        "new_data_oos_path": None,
        "model_path": None,
        "uploaded_model_feature_names": None,
        "uploaded_model_hyperparameters": None,
        "preprocess_path": None,
        "features_path": None,
        "data_dictionary_path": None,
        "dev_scores_path": None,
        # agent results
        "inception_result": None,
        "ingestion_result": None,
        "reproducibility_result": None,
        "drift_result": None,
        "recalibration_result": None,
        "evaluation_result": None,
        # agent run state
        "agent_runs": {},
        # recalibration config
        "drop_list": [],
        "model_class": "XGBoost",
        "hp_method": "random",
        "cv_folds": 3,
        # demo mode
        "demo_mode": False,
    }
    with _lock:
        _sessions[session_id] = payload
        _write_session(session_id, payload)
    return session_id


def get_session(session_id: str) -> Optional[Dict[str, Any]]:
    with _lock:
        cached = _sessions.get(session_id)
        if cached is not None:
            return cached
        loaded = _read_session(session_id)
        if loaded is not None:
            _sessions[session_id] = loaded
        return loaded


def update_session(session_id: str, updates: Dict[str, Any]) -> None:
    with _lock:
        session = get_session(session_id)
        if session is None:
            return
        session.update(updates)
        _write_session(session_id, session)


def get_or_create_session(session_id: Optional[str]) -> str:
    if session_id and get_session(session_id):
        return session_id
    return create_session()


def session_dir(session_id: str) -> str:
    d = os.path.join(tempfile.gettempdir(), "sessions", session_id)
    os.makedirs(d, exist_ok=True)
    return d


def persist_session(session_id: str) -> None:
    with _lock:
        payload = _sessions.get(session_id)
        if payload is None:
            return
        _write_session(session_id, payload)


def _read_session(session_id: str) -> Optional[Dict[str, Any]]:
    with sqlite3.connect(_db_path) as conn:
        row = conn.execute("SELECT payload FROM sessions WHERE session_id = ?", (session_id,)).fetchone()
    if not row:
        return None
    return json.loads(row[0])


def _write_session(session_id: str, payload: Dict[str, Any]) -> None:
    serialized = json.dumps(payload, default=str)
    with sqlite3.connect(_db_path) as conn:
        conn.execute(
            """
            INSERT INTO sessions (session_id, payload, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(session_id) DO UPDATE
            SET payload=excluded.payload, updated_at=CURRENT_TIMESTAMP
            """,
            (session_id, serialized),
        )
        conn.commit()
