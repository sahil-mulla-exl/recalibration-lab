from fastapi import APIRouter, Query
from backend.app.utils.session import get_session

router = APIRouter()


@router.get("/report")
async def get_evaluation_report(session_id: str = Query(...)):
    session = get_session(session_id)
    if not session:
        return {"error": "Session not found"}
    result = session.get("evaluation_result") or session.get("comparison_result")
    if not result:
        return {"error": "Evaluation not run yet"}
    return result
