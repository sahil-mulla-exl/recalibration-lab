from fastapi import APIRouter, Query

from backend.app.core.governance import load_governance
from backend.app.utils.session import get_session

router = APIRouter()


@router.get("")
async def get_governance(session_id: str = Query(default="")):
    session = get_session(session_id) if session_id else {}
    return load_governance(session or {})
