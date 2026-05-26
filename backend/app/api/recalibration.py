from fastapi import APIRouter
from backend.app.utils.session import get_session, update_session

router = APIRouter()


@router.post("/configure")
async def configure_recalibration(body: dict):
    session_id = body.get("session_id")
    if not session_id:
        return {"error": "session_id required"}
    selected_action = str(body.get("selected_action") or "").strip().lower()
    search_space = body.get("search_space") or {}
    if selected_action == "recal_simple":
        search_space = {}

    update_session(session_id, {
        "drop_list": body.get("drops", []),
        "model_class": body.get("model_class", "XGBoost"),
        "hp_method": body.get("hp_method", "random"),
        "cv_folds": int(body.get("cv_folds", 3)),
        "hp_search_space": search_space,
        "selected_recommended_action": selected_action or body.get("selected_action"),
    })
    return {"ok": True}
