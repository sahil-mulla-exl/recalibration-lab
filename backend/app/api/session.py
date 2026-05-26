from fastapi import APIRouter, HTTPException
from backend.app.utils.session import create_session, get_session, update_session

router = APIRouter()


@router.post("/init")
async def init_session():
    session_id = create_session()
    return {"session_id": session_id}


@router.get("/{session_id}")
async def check_session(session_id: str):
    """Validate that a session exists — used by the frontend to detect stale localStorage."""
    session = get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    from backend.app.utils.model_features import load_model_feature_names_from_session

    features = load_model_feature_names_from_session(session)
    return {
        "session_id": session_id,
        "ok": True,
        "model_features": features,
        "model_feature_count": len(features),
    }


@router.post("/demo-mode")
async def set_demo_mode(body: dict):
    session_id = body.get("session_id")
    demo_mode = body.get("demo_mode", False)
    if not session_id:
        return {"error": "session_id required"}
    update_session(session_id, {"demo_mode": demo_mode})
    return {"ok": True, "demo_mode": demo_mode}
