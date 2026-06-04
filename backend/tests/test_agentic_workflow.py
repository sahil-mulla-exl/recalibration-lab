import asyncio

from backend.app.agentic.orchestrator import WorkflowOrchestrator
from backend.app.utils import session as session_store


def test_session_persists_across_memory_cache() -> None:
    session_id = session_store.create_session()
    session_store.update_session(session_id, {"model_id": "model-123", "demo_mode": True})
    assert session_store.get_session(session_id) is not None
    session_store._sessions.pop(session_id, None)  # type: ignore[attr-defined]
    loaded = session_store.get_session(session_id)
    assert loaded is not None
    assert loaded.get("model_id") == "model-123"
    assert loaded.get("demo_mode") is True


def test_workflow_run_emits_events() -> None:
    async def _run() -> None:
        session_id = session_store.create_session()
        orch = WorkflowOrchestrator()
        run = orch.start_run(session_id, mode="supervised")
        assert run.status == "running"

        for _ in range(30):
            current = orch.status(run.run_id)
            assert current is not None
            if current.events:
                break
            await asyncio.sleep(0.1)

        current = orch.status(run.run_id)
        assert current is not None
        assert len(current.events) > 0

    asyncio.run(_run())
