import uuid
from typing import Any, Dict, Optional

# In-memory session store
_sessions: Dict[str, Dict[str, Any]] = {}


def create_session() -> str:
    session_id = str(uuid.uuid4())
    _sessions[session_id] = {
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
    return session_id


def get_session(session_id: str) -> Optional[Dict[str, Any]]:
    return _sessions.get(session_id)


def update_session(session_id: str, updates: Dict[str, Any]) -> None:
    if session_id in _sessions:
        _sessions[session_id].update(updates)


def get_or_create_session(session_id: Optional[str]) -> str:
    if session_id and session_id in _sessions:
        return session_id
    return create_session()


def session_dir(session_id: str) -> str:
    import os
    d = f"/tmp/sessions/{session_id}"
    os.makedirs(d, exist_ok=True)
    return d
