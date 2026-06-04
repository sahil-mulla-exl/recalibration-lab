from __future__ import annotations

import asyncio
import importlib
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, Optional, TypedDict

from backend.app.agentic.memory import MemoryStore
from backend.app.agentic.runtime import AgentRuntime
from backend.app.agentic.schemas import AgentPlan, AgenticEvent, HitlRequest, ToolCall, WorkflowRun, WorkflowStatus, utc_now
from backend.app.agentic.tools_workflow import build_default_registry
from backend.app.utils.session import get_session, persist_session
from langgraph.graph import END, START, StateGraph


AGENT_CLASS_REGISTRY: Dict[str, tuple[str, str]] = {
    "inventory": ("backend.app.agentic.agents", "InventoryAgent"),
    "ingestion": ("backend.app.services.ingestion_agent", "IngestionAgent"),
    "reproducibility": ("backend.app.services.reproducibility_agent", "ReproducibilityAgent"),
    "drift": ("backend.app.services.drift_agent", "DriftDiagnosticsAgent"),
    "recalibration": ("backend.app.services.recalibration_agent", "RecalibrationAgent"),
    "evaluation": ("backend.app.services.evaluation_agent", "EvaluationAgent"),
    "export": ("backend.app.agentic.agents", "ExportAgent"),
}


@dataclass
class _RunState:
    run: WorkflowRun
    wake: asyncio.Event = field(default_factory=asyncio.Event)
    resume_future: Optional[asyncio.Future] = None


class _WorkflowQueue:
    def __init__(self, orch: "WorkflowOrchestrator", run_id: str, agent_name: str):
        self.orch = orch
        self.run_id = run_id
        self.agent_name = agent_name

    async def put(self, item) -> None:
        if item is None:
            return
        self.orch.append_event(
            self.run_id,
            AgenticEvent(
                event_type=item.get("event_type", "task"),
                workflow_run_id=self.run_id,
                agent=self.agent_name,
                payload=item,
            ),
        )


class WorkflowGraphState(TypedDict):
    run_id: str
    session_id: str
    mode: str
    promotion_required: bool


class WorkflowOrchestrator:
    def __init__(self) -> None:
        self._runs: Dict[str, _RunState] = {}
        self._runtime = AgentRuntime(tool_registry=build_default_registry(), memory_store=MemoryStore())
        self._graph = self._build_graph()

    def _build_graph(self):
        graph = StateGraph(WorkflowGraphState)
        graph.add_node("inventory", self._inventory_node)
        graph.add_node("ingestion", self._ingestion_node)
        graph.add_node("reproducibility", self._reproducibility_node)
        graph.add_node("drift", self._drift_node)
        graph.add_node("diagnostic_gate", self._diagnostic_gate_node)
        graph.add_node("recalibration", self._recalibration_node)
        graph.add_node("recalibration_gate", self._recalibration_gate_node)
        graph.add_node("evaluation", self._evaluation_node)
        graph.add_node("promotion_gate", self._promotion_gate_node)
        graph.add_node("export", self._export_node)

        graph.add_edge(START, "inventory")
        graph.add_edge("inventory", "ingestion")
        graph.add_edge("ingestion", "reproducibility")
        graph.add_edge("reproducibility", "drift")
        graph.add_edge("drift", "diagnostic_gate")
        graph.add_edge("diagnostic_gate", "recalibration")
        graph.add_edge("recalibration", "recalibration_gate")
        graph.add_edge("recalibration_gate", "evaluation")
        graph.add_conditional_edges(
            "evaluation",
            self._route_after_evaluation,
            {"promotion_gate": "promotion_gate", "export": "export"},
        )
        graph.add_edge("promotion_gate", "export")
        graph.add_edge("export", END)
        return graph.compile()

    def _save_run_to_session(self, run: WorkflowRun) -> None:
        session = get_session(run.session_id)
        if not session:
            return
        workflows = session.setdefault("workflow_runs", {})
        workflows[run.run_id] = run.model_dump()
        persist_session(run.session_id)

    def get_run(self, run_id: str) -> Optional[WorkflowRun]:
        state = self._runs.get(run_id)
        return state.run if state else None

    def append_event(self, run_id: str, event: AgenticEvent) -> None:
        state = self._runs.get(run_id)
        if not state:
            return
        payload = event.model_dump()
        state.run.events.append(payload)
        state.wake.set()
        state.wake = asyncio.Event()
        self._save_run_to_session(state.run)

    async def wait_for_update(self, run_id: str, timeout: float = 5.0) -> bool:
        state = self._runs.get(run_id)
        if not state:
            return False
        try:
            await asyncio.wait_for(state.wake.wait(), timeout=timeout)
            return True
        except asyncio.TimeoutError:
            return False

    def _agent_class(self, agent_name: str):
        module_name, class_name = AGENT_CLASS_REGISTRY[agent_name]
        module = importlib.import_module(module_name)
        return getattr(module, class_name)

    async def _run_agent(self, run_id: str, agent_name: str, session_id: str) -> Dict[str, Any]:
        tool_name = {
            "inventory": "inventory_prepare",
            "ingestion": "ingestion_validate",
            "reproducibility": "reproducibility_score",
            "drift": "recommend_action",
            "recalibration": "recalibration_train",
            "evaluation": "evaluation_compare",
            "export": "export_bundle",
        }.get(agent_name, "inventory_prepare")
        await self._runtime.run_plan(
            workflow_run_id=run_id,
            session_id=session_id,
            agent_name=agent_name,
            goal=f"Prepare deterministic execution envelope for {agent_name} agent.",
            fallback_plan=AgentPlan(
                summary=f"Execute {agent_name} in deterministic mode.",
                actions=[ToolCall(name=tool_name, args={"agent": agent_name})],
            ),
        )
        queue = _WorkflowQueue(self, run_id, agent_name)
        agent_cls = self._agent_class(agent_name)
        last_exc: Optional[Exception] = None
        for attempt in (1, 2):
            try:
                agent = agent_cls(session_id, queue)
                result = await agent.run()
                self.append_event(
                    run_id,
                    AgenticEvent(
                        event_type="handoff",
                        workflow_run_id=run_id,
                        payload={"from": agent_name, "to": "supervisor", "attempt": attempt},
                    ),
                )
                return result
            except Exception as exc:  # pragma: no cover
                last_exc = exc
                self.append_event(
                    run_id,
                    AgenticEvent(
                        event_type="log",
                        workflow_run_id=run_id,
                        payload={"agent": agent_name, "attempt": attempt, "message": str(exc)},
                    ),
                )
                if attempt == 1:
                    await asyncio.sleep(0.2)
        raise RuntimeError(str(last_exc) if last_exc else f"{agent_name} failed")

    async def _inventory_node(self, state: WorkflowGraphState) -> WorkflowGraphState:
        self._runs[state["run_id"]].run.current_node = "inventory"
        await self._run_agent(state["run_id"], "inventory", state["session_id"])
        return state

    async def _ingestion_node(self, state: WorkflowGraphState) -> WorkflowGraphState:
        self._runs[state["run_id"]].run.current_node = "ingestion"
        await self._run_agent(state["run_id"], "ingestion", state["session_id"])
        return state

    async def _reproducibility_node(self, state: WorkflowGraphState) -> WorkflowGraphState:
        self._runs[state["run_id"]].run.current_node = "reproducibility"
        await self._run_agent(state["run_id"], "reproducibility", state["session_id"])
        return state

    async def _drift_node(self, state: WorkflowGraphState) -> WorkflowGraphState:
        self._runs[state["run_id"]].run.current_node = "drift"
        await self._run_agent(state["run_id"], "drift", state["session_id"])
        return state

    async def _pause_for_human(self, state: _RunState, request: HitlRequest) -> Dict[str, Any]:
        state.run.pending_hitl = request
        state.run.status = "waiting_human"
        state.run.current_node = request.gate
        self.append_event(
            state.run.run_id,
            AgenticEvent(
                event_type="human_input_required",
                workflow_run_id=state.run.run_id,
                payload=request.model_dump(),
            ),
        )
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        state.resume_future = fut
        decision = await fut
        state.resume_future = None
        state.run.pending_hitl = None
        state.run.status = "running"
        self.append_event(
            state.run.run_id,
            AgenticEvent(
                event_type="human_input_resumed",
                workflow_run_id=state.run.run_id,
                payload={"decision": decision},
            ),
        )
        return decision

    async def _diagnostic_gate_node(self, state: WorkflowGraphState) -> WorkflowGraphState:
        run_state = self._runs[state["run_id"]]
        run_state.run.current_node = "diagnostic_gate"
        await self._pause_for_human(
            run_state,
            HitlRequest(
                gate="diagnostic_action",
                recommendation={"action": "recal_with_hp_opt", "rationale": "Recommendation generated from drift diagnostics."},
                allowed_actions=["no_action", "recal_same_hp", "recal_with_hp_opt", "model_redevelopment"],
                context_ref="drift_result",
            ),
        )
        return state

    async def _recalibration_node(self, state: WorkflowGraphState) -> WorkflowGraphState:
        self._runs[state["run_id"]].run.current_node = "recalibration"
        await self._run_agent(state["run_id"], "recalibration", state["session_id"])
        return state

    async def _recalibration_gate_node(self, state: WorkflowGraphState) -> WorkflowGraphState:
        run_state = self._runs[state["run_id"]]
        run_state.run.current_node = "recalibration_gate"
        await self._pause_for_human(
            run_state,
            HitlRequest(
                gate="recalibration_config",
                recommendation={"action": "confirm_configuration", "rationale": "Review feature drops and hyperparameter bounds before training."},
                allowed_actions=["confirm_configuration", "override_configuration"],
                context_ref="recalibration_config",
            ),
        )
        return state

    async def _evaluation_node(self, state: WorkflowGraphState) -> WorkflowGraphState:
        self._runs[state["run_id"]].run.current_node = "evaluation"
        await self._run_agent(state["run_id"], "evaluation", state["session_id"])
        eval_result = (get_session(state["session_id"]) or {}).get("evaluation_result") or {}
        status = str(eval_result.get("model_promotion_status") or "").lower()
        state["promotion_required"] = status in {"warn", "block"}
        return state

    async def _promotion_gate_node(self, state: WorkflowGraphState) -> WorkflowGraphState:
        run_state = self._runs[state["run_id"]]
        run_state.run.current_node = "promotion_gate"
        await self._pause_for_human(
            run_state,
            HitlRequest(
                gate="promotion",
                recommendation={"action": "hold", "rationale": "Policy guardrails require human review."},
                allowed_actions=["hold", "override_and_continue"],
                context_ref="evaluation_result.policy_guardrails",
            ),
        )
        return state

    async def _export_node(self, state: WorkflowGraphState) -> WorkflowGraphState:
        self._runs[state["run_id"]].run.current_node = "export"
        await self._run_agent(state["run_id"], "export", state["session_id"])
        return state

    @staticmethod
    def _route_after_evaluation(state: WorkflowGraphState) -> str:
        return "promotion_gate" if state.get("promotion_required") else "export"

    async def _workflow_task(self, state: _RunState) -> None:
        run = state.run
        try:
            self.append_event(
                run.run_id,
                AgenticEvent(
                    event_type="workflow_started",
                    workflow_run_id=run.run_id,
                    payload={"session_id": run.session_id, "mode": run.mode},
                ),
            )
            await self._graph.ainvoke(
                {
                    "run_id": run.run_id,
                    "session_id": run.session_id,
                    "mode": run.mode,
                    "promotion_required": False,
                },
                config={"configurable": {"thread_id": run.run_id}},
            )
            run.status = "completed"
            run.current_node = "end"
            run.result = {"finished_at": utc_now()}
            self.append_event(
                run.run_id,
                AgenticEvent(
                    event_type="workflow_completed",
                    workflow_run_id=run.run_id,
                    payload=run.result or {},
                ),
            )
        except Exception as exc:  # pragma: no cover
            run.status = "failed"
            run.error = str(exc)
            self.append_event(
                run.run_id,
                AgenticEvent(
                    event_type="workflow_failed",
                    workflow_run_id=run.run_id,
                    payload={"error": str(exc)},
                ),
            )
        finally:
            self._save_run_to_session(run)

    def start_run(self, session_id: str, mode: str = "supervised") -> WorkflowRun:
        run_id = f"wf_{uuid.uuid4().hex[:10]}"
        run = WorkflowRun(run_id=run_id, session_id=session_id, mode="autonomous" if mode == "autonomous" else "supervised")
        state = _RunState(run=run)
        self._runs[run_id] = state
        self._save_run_to_session(run)
        asyncio.create_task(self._workflow_task(state))
        return run

    def resume(self, run_id: str, decision: Dict[str, Any]) -> WorkflowRun:
        state = self._runs.get(run_id)
        if not state:
            raise ValueError("Workflow run not found")
        if not state.resume_future or state.resume_future.done():
            raise ValueError("Workflow is not waiting for human input")
        state.resume_future.set_result(decision)
        return state.run

    def status(self, run_id: str) -> Optional[WorkflowRun]:
        state = self._runs.get(run_id)
        return state.run if state else None


orchestrator = WorkflowOrchestrator()
