from __future__ import annotations

from typing import Any, Callable, Dict, Optional, TypedDict

from backend.app.agentic.memory import MemoryStore
from backend.app.agentic.schemas import AgentPlan, AgenticEvent, ReflectionResult
from backend.app.agentic.tools import ToolRegistry
from backend.app.services.llm_service import LLMService
from langgraph.graph import END, START, StateGraph


EventSink = Callable[[AgenticEvent], None]


class RuntimeState(TypedDict):
    workflow_run_id: str
    session_id: str
    agent_name: str
    goal: str
    llm_context: str
    plan: AgentPlan
    queue: list[Dict[str, Any]]
    outputs: Dict[str, Any]
    reflection: ReflectionResult | None
    done: bool


class AgentRuntime:
    def __init__(
        self,
        tool_registry: ToolRegistry,
        memory_store: MemoryStore,
        event_sink: Optional[EventSink] = None,
        llm_service: Optional[LLMService] = None,
        max_iterations: int = 2,
    ) -> None:
        self.tool_registry = tool_registry
        self.memory_store = memory_store
        self.event_sink = event_sink
        self.llm_service = llm_service or LLMService()
        self.max_iterations = max_iterations

    def _emit(self, evt: AgenticEvent) -> None:
        self.memory_store.append_event(evt.payload.get("session_id", ""), evt.model_dump())
        if self.event_sink is not None:
            self.event_sink(evt)

    async def _planner(self, state: RuntimeState) -> RuntimeState:
        plan = state["plan"]
        if self.llm_service.is_ready():
            candidate = await self.llm_service.generate_text_async(
                prompt=(
                    "Plan deterministic tool calls for this agent.\n"
                    f"Agent={state['agent_name']}\nGoal={state['goal']}\n"
                    "Return concise plan and risks."
                ),
                context=state["llm_context"],
            )
            if candidate:
                self._emit(
                    AgenticEvent(
                        event_type="plan",
                        workflow_run_id=state["workflow_run_id"],
                        agent=state["agent_name"],
                        payload={"session_id": state["session_id"], "draft": candidate},
                    )
                )

        self._emit(
            AgenticEvent(
                event_type="plan",
                workflow_run_id=state["workflow_run_id"],
                agent=state["agent_name"],
                payload={
                    "session_id": state["session_id"],
                    "summary": plan.summary,
                    "actions": [a.model_dump() for a in plan.actions],
                },
            )
        )
        state["queue"] = [a.model_dump() for a in plan.actions]
        state["outputs"] = {}
        state["reflection"] = None
        state["done"] = len(state["queue"]) == 0
        return state

    async def _execute_tool(self, state: RuntimeState) -> RuntimeState:
        if not state["queue"]:
            state["done"] = True
            return state
        action = state["queue"].pop(0)
        tool_name = str(action.get("name") or "")
        tool_args = dict(action.get("args") or {})
        self._emit(
            AgenticEvent(
                event_type="tool_call",
                workflow_run_id=state["workflow_run_id"],
                agent=state["agent_name"],
                payload={"session_id": state["session_id"], "tool": tool_name, "args": tool_args},
            )
        )
        langchain_tools = self.tool_registry.as_langchain_tools(state["session_id"])
        tool = langchain_tools.get(tool_name)
        if tool is None:
            raise ValueError(f"Unknown tool: {tool_name}")
        result = await tool.ainvoke(tool_args)
        state["outputs"][tool_name] = result
        state["done"] = len(state["queue"]) == 0
        return state

    async def _reflect(self, state: RuntimeState) -> RuntimeState:
        reflection = ReflectionResult(status="done", rationale="LangGraph tool execution complete.")
        self._emit(
            AgenticEvent(
                event_type="reflection",
                workflow_run_id=state["workflow_run_id"],
                agent=state["agent_name"],
                payload={"session_id": state["session_id"], **reflection.model_dump()},
            )
        )
        state["reflection"] = reflection
        return state

    @staticmethod
    def _route_after_planner(state: RuntimeState) -> str:
        return "reflect" if state["done"] else "execute"

    @staticmethod
    def _route_after_execute(state: RuntimeState) -> str:
        return "reflect" if state["done"] else "execute"

    async def run_plan(
        self,
        *,
        workflow_run_id: str,
        session_id: str,
        agent_name: str,
        goal: str,
        fallback_plan: AgentPlan,
        llm_context: str = "default_chat",
    ) -> Dict[str, Any]:
        graph = StateGraph(RuntimeState)
        graph.add_node("planner", self._planner)
        graph.add_node("execute", self._execute_tool)
        graph.add_node("reflect", self._reflect)
        graph.add_edge(START, "planner")
        graph.add_conditional_edges("planner", self._route_after_planner, {"execute": "execute", "reflect": "reflect"})
        graph.add_conditional_edges("execute", self._route_after_execute, {"execute": "execute", "reflect": "reflect"})
        graph.add_edge("reflect", END)
        compiled = graph.compile()

        initial_state: RuntimeState = {
            "workflow_run_id": workflow_run_id,
            "session_id": session_id,
            "agent_name": agent_name,
            "goal": goal,
            "llm_context": llm_context,
            "plan": fallback_plan,
            "queue": [],
            "outputs": {},
            "reflection": None,
            "done": False,
        }
        result_state = await compiled.ainvoke(initial_state)
        reflection = result_state.get("reflection")
        if reflection and reflection.status == "failed":
            raise RuntimeError(reflection.rationale)
        return dict(result_state.get("outputs") or {})
