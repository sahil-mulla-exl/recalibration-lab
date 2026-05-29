import asyncio
import json
import math
import time
from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from backend.app.utils.session import get_session, update_session

router = APIRouter()

AGENT_REGISTRY = {
    "ingestion": ("backend.app.services.ingestion_agent", "IngestionAgent"),
    "reproducibility": ("backend.app.services.reproducibility_agent", "ReproducibilityAgent"),
    "drift": ("backend.app.services.drift_agent", "DriftDiagnosticsAgent"),
    "recalibration": ("backend.app.services.recalibration_agent", "RecalibrationAgent"),
    "evaluation": ("backend.app.services.evaluation_agent", "EvaluationAgent"),
}


class EventBufferQueue:
    """Async queue compatible with agents; buffers events on the session for late SSE clients."""

    def __init__(self, session_id: str, agent_name: str):
        self.session_id = session_id
        self.agent_name = agent_name
        self._wake = asyncio.Event()

    def _append_event(self, item: dict) -> None:
        session = get_session(self.session_id)
        if not session:
            return
        agent_runs = session.setdefault("agent_runs", {})
        info = agent_runs.get(self.agent_name)
        if info is None:
            return
        info.setdefault("events", []).append(item)

    async def put(self, item) -> None:
        if item is not None:
            self._append_event(item)
        self._wake.set()
        self._wake = asyncio.Event()

    async def wait_for_update(self, timeout: float) -> bool:
        try:
            await asyncio.wait_for(self._wake.wait(), timeout=timeout)
            return True
        except asyncio.TimeoutError:
            return False


def _json_safe(value):
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return value
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    if isinstance(value, tuple):
        return [_json_safe(v) for v in value]
    return value


def _get_agent_class(agent_name: str):
    if agent_name not in AGENT_REGISTRY:
        raise ValueError(f"Unknown agent: {agent_name}")
    module_name, class_name = AGENT_REGISTRY[agent_name]
    import importlib
    mod = importlib.import_module(module_name)
    return getattr(mod, class_name)


def _get_run_info(session_id: str, agent_name: str) -> dict | None:
    session = get_session(session_id)
    if not session:
        return None
    return (session.get("agent_runs") or {}).get(agent_name)


def _set_agent_run(session_id: str, agent_name: str, run_info: dict) -> None:
    session = get_session(session_id)
    if not session:
        return
    session.setdefault("agent_runs", {})[agent_name] = run_info


@router.post("/{agent_name}/run")
async def run_agent(agent_name: str, body: dict):
    session_id = body.get("session_id")
    if not session_id:
        return {"error": "session_id required"}

    session = get_session(session_id)
    if not session:
        return {"error": "Session not found"}

    params = body.get("params") or {}
    if params:
        update_session(session_id, params)

    queue = EventBufferQueue(session_id, agent_name)
    run_id = f"{agent_name}_{session_id[:8]}"

    _set_agent_run(
        session_id,
        agent_name,
        {
            "run_id": run_id,
            "status": "running",
            "queue": queue,
            "result": None,
            "events": [],
        },
    )

    try:
        AgentClass = _get_agent_class(agent_name)
    except ValueError as e:
        return {"error": str(e)}

    agent = AgentClass(session_id, queue)

    async def _run():
        try:
            result = await agent.run()
            info = _get_run_info(session_id, agent_name)
            if info is not None:
                info["status"] = "completed"
                info["result"] = result
        except Exception as e:
            info = _get_run_info(session_id, agent_name)
            if info is not None:
                info["status"] = "failed"
            await queue.put({
                "agent": agent_name,
                "event_type": "failed",
                "message": str(e) or "Agent execution failed",
            })

    asyncio.create_task(_run())

    return {"run_id": run_id, "status": "started"}


async def _wait_for_run_info(session_id: str, agent_name: str, timeout_sec: float = 45.0):
    """Allow the SSE client to connect slightly before POST /run completes."""
    deadline = time.monotonic() + timeout_sec
    while time.monotonic() < deadline:
        run_info = _get_run_info(session_id, agent_name)
        if run_info:
            return get_session(session_id), run_info
        await asyncio.sleep(0.2)
    return get_session(session_id), _get_run_info(session_id, agent_name)


@router.get("/{agent_name}/status")
async def agent_status(agent_name: str, session_id: str = Query(...)):
    """Pollable snapshot of agent run state (fallback when SSE is buffered)."""
    run_info = _get_run_info(session_id, agent_name)
    if not run_info:
        return {"status": "not_started", "events": [], "result": None}
    return {
        "status": run_info.get("status"),
        "events": _json_safe(run_info.get("events") or []),
        "result": _json_safe(run_info.get("result")),
    }


_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


@router.get("/{agent_name}/events")
async def agent_events(agent_name: str, session_id: str = Query(...)):
    """Stream agent events. Response headers are sent immediately; run wait happens inside the stream."""

    async def _stream():
        # Open the SSE connection right away (avoids frontend deadlock waiting for POST /run).
        yield f"data: {json.dumps({'event_type': 'connected', 'message': 'stream open'})}\n\n"

        session, run_info = await _wait_for_run_info(session_id, agent_name)
        if not session:
            yield f"data: {json.dumps({'event_type': 'failed', 'message': 'Session not found'})}\n\n"
            return
        if not run_info:
            yield f"data: {json.dumps({'event_type': 'failed', 'message': f'Agent {agent_name} has not been started'})}\n\n"
            return

        queue: EventBufferQueue | None = run_info.get("queue")
        if not queue:
            queue = EventBufferQueue(session_id, agent_name)
            run_info["queue"] = queue

        cursor = 0
        while True:
            run_info = _get_run_info(session_id, agent_name)
            if not run_info:
                break

            events = run_info.get("events") or []
            while cursor < len(events):
                item = events[cursor]
                cursor += 1
                yield f"data: {json.dumps(_json_safe(item))}\n\n"

            status = run_info.get("status")
            if status == "completed":
                safe_output = _json_safe(run_info.get("result"))
                yield f"data: {json.dumps({'event_type': 'completed', 'output': safe_output})}\n\n"
                break
            if status == "failed":
                last_msg = "Agent execution failed"
                for evt in reversed(events):
                    if evt.get("event_type") == "failed" and evt.get("message"):
                        last_msg = str(evt["message"])
                        break
                yield f"data: {json.dumps({'event_type': 'failed', 'message': last_msg})}\n\n"
                break

            queue_ref: EventBufferQueue | None = run_info.get("queue")
            if queue_ref:
                woke = await queue_ref.wait_for_update(timeout=5.0)
            else:
                await asyncio.sleep(0.5)
                woke = False
            if not woke:
                yield f"data: {json.dumps({'event_type': 'heartbeat'})}\n\n"

    return StreamingResponse(_stream(), media_type="text/event-stream", headers=_SSE_HEADERS)


@router.get("/{agent_name}/result")
async def agent_result(agent_name: str, session_id: str = Query(...)):
    run_info = _get_run_info(session_id, agent_name)
    if not run_info:
        return {"error": f"Agent {agent_name} has not been run"}

    return {
        "status": run_info.get("status"),
        "result": _json_safe(run_info.get("result")),
    }
