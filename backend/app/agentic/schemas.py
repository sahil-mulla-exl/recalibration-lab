from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


WorkflowStatus = Literal["running", "waiting_human", "completed", "failed"]
WorkflowGate = Literal["inventory_confirm", "ingestion_mapping", "diagnostic_action", "recalibration_config", "promotion"]


class ToolCall(BaseModel):
    name: str
    args: Dict[str, Any] = Field(default_factory=dict)


class AgentPlan(BaseModel):
    summary: str
    actions: List[ToolCall] = Field(default_factory=list)


class ReflectionResult(BaseModel):
    status: Literal["done", "retry", "failed"]
    rationale: str


class AgenticEvent(BaseModel):
    event_type: str
    workflow_run_id: str
    timestamp: str = Field(default_factory=utc_now)
    agent: Optional[str] = None
    payload: Dict[str, Any] = Field(default_factory=dict)


class HitlRequest(BaseModel):
    gate: WorkflowGate
    recommendation: Dict[str, Any]
    allowed_actions: List[str]
    context_ref: Optional[str] = None


class WorkflowRun(BaseModel):
    run_id: str
    session_id: str
    mode: Literal["supervised", "autonomous"] = "supervised"
    status: WorkflowStatus = "running"
    current_node: str = "inventory"
    pending_hitl: Optional[HitlRequest] = None
    events: List[Dict[str, Any]] = Field(default_factory=list)
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
