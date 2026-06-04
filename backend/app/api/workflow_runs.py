import asyncio
import json
from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from backend.app.agentic.orchestrator import orchestrator
from backend.app.agentic.schemas import AgenticEvent
from backend.app.utils.session import get_session

router = APIRouter()


@router.post("/runs")
async def start_workflow_run(body: dict):
    session_id = body.get("session_id")
    mode = body.get("mode") or "supervised"
    if not session_id:
        return {"error": "session_id required"}
    if not get_session(session_id):
        return {"error": "Session not found"}
    run = orchestrator.start_run(session_id, mode=mode)
    return {"run_id": run.run_id, "status": run.status}


@router.get("/runs/{run_id}")
async def workflow_run_status(run_id: str):
    run = orchestrator.status(run_id)
    if not run:
        return {"error": "Workflow run not found"}
    return run.model_dump()


@router.get("/runs/{run_id}/pending-hitl")
async def workflow_pending_hitl(run_id: str):
    run = orchestrator.status(run_id)
    if not run:
        return {"error": "Workflow run not found"}
    return {"status": run.status, "pending_hitl": run.pending_hitl.model_dump() if run.pending_hitl else None}


@router.post("/runs/{run_id}/resume")
async def workflow_resume(run_id: str, body: dict):
    try:
        run = orchestrator.resume(run_id, decision=body)
        return {"ok": True, "status": run.status}
    except ValueError as exc:
        return {"error": str(exc)}


_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


@router.get("/runs/{run_id}/events")
async def workflow_events(run_id: str, cursor: int = Query(0)):
    async def _stream():
        index = max(cursor, 0)
        yield f"data: {json.dumps({'event_type': 'connected', 'run_id': run_id})}\n\n"
        while True:
            run = orchestrator.status(run_id)
            if not run:
                yield f"data: {json.dumps({'event_type': 'failed', 'message': 'Workflow run not found'})}\n\n"
                break

            while index < len(run.events):
                event = run.events[index]
                index += 1
                yield f"data: {json.dumps(event)}\n\n"

            if run.status == "completed":
                done = AgenticEvent(event_type="completed", workflow_run_id=run_id, payload=run.result or {})
                yield f"data: {json.dumps(done.model_dump())}\n\n"
                break
            if run.status == "failed":
                failed = AgenticEvent(event_type="failed", workflow_run_id=run_id, payload={"error": run.error or "Workflow failed"})
                yield f"data: {json.dumps(failed.model_dump())}\n\n"
                break

            woke = await orchestrator.wait_for_update(run_id, timeout=5.0)
            if not woke:
                yield f"data: {json.dumps({'event_type': 'heartbeat'})}\n\n"
            await asyncio.sleep(0)

    return StreamingResponse(_stream(), media_type="text/event-stream", headers=_SSE_HEADERS)
