from fastapi import APIRouter
from backend.app.utils.session import get_session, update_session

router = APIRouter()


@router.post("/select-model")
async def select_model(body: dict):
    session_id = body.get("session_id")
    model_id = body.get("model_id")
    model_entry = body.get("model_entry")
    if not session_id or not model_id:
        return {"error": "session_id and model_id required"}
    hp_method = "random"
    if isinstance(model_entry, dict):
        hp_method = model_entry.get("optimization_method") or "random"
    update_session(
        session_id,
        {
            "model_id": model_id,
            "model_entry": model_entry,
            "hp_method": hp_method,
        },
    )
    return {"ok": True}


@router.post("/clear-model")
async def clear_model_state(body: dict):
    session_id = body.get("session_id")
    if not session_id:
        return {"error": "session_id required"}

    session = get_session(session_id)
    if not session:
        return {"error": "Session not found"}

    update_session(
        session_id,
        {
            # Selected model
            "model_id": None,
            "model_entry": None,
            # Ingestion artifacts
            "dev_data_path": None,
            "new_data_path": None,
            "hold_data_path": None,
            "new_data_oos_path": None,
            "model_path": None,
            "uploaded_model_hyperparameters": None,
            "uploaded_model_feature_names": None,
            "preprocess_path": None,
            "features_path": None,
            "data_dictionary_path": None,
            "dev_scores_path": None,
            "processed_dev_path": None,
            "processed_new_path": None,
            "processed_hold_path": None,
            "processed_oos_path": None,
            "oot_data_source": None,
            "processed_score_column": None,
            # Agent outputs
            "inception_result": None,
            "ingestion_result": None,
            "reproducibility_result": None,
            "drift_result": None,
            "recalibration_result": None,
            "evaluation_result": None,
            # Recalibration outputs/config
            "new_model_path": None,
            "oot_scores_path": None,
            "drop_list": [],
            "model_class": "XGBoost",
            "hp_method": "random",
            "cv_folds": 3,
            # Agent run state
            "agent_runs": {},
        },
    )
    return {"ok": True}
