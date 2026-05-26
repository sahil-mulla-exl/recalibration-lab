import asyncio
import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from pydantic import BaseModel


class AgentEvent(BaseModel):
    agent: str
    event_type: str  # 'started','task','progress','log','output','completed','failed'
    task_id: Optional[str] = None
    task_name: Optional[str] = None
    task_status: Optional[str] = None  # 'pending','running','completed','failed'
    progress: Optional[float] = None
    message: Optional[str] = None
    output: Optional[Dict[str, Any]] = None
    timestamp: str


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Agent:
    def __init__(self, agent_name: str, session_id: str, queue: asyncio.Queue):
        self.name = agent_name
        self.session_id = session_id
        self.queue = queue
        self.tasks: List[Dict[str, Any]] = []  # declared upfront

    def _declare_tasks(self, task_defs: List[Dict[str, str]]) -> None:
        self.tasks = [
            {"id": t["id"], "name": t["name"], "status": "pending", "output": None}
            for t in task_defs
        ]

    async def emit(self, event: AgentEvent) -> None:
        await self.queue.put(event.model_dump())

    async def started(self) -> None:
        await self.emit(AgentEvent(
            agent=self.name,
            event_type="started",
            message=f"Agent {self.name} started",
            timestamp=_now(),
        ))
        # Emit all tasks as pending upfront
        for task in self.tasks:
            await self.emit(AgentEvent(
                agent=self.name,
                event_type="task",
                task_id=task["id"],
                task_name=task["name"],
                task_status="pending",
                timestamp=_now(),
            ))

    async def task_started(self, task_id: str) -> None:
        for t in self.tasks:
            if t["id"] == task_id:
                t["status"] = "running"
        await self.emit(AgentEvent(
            agent=self.name,
            event_type="task",
            task_id=task_id,
            task_name=self._task_name(task_id),
            task_status="running",
            timestamp=_now(),
        ))

    async def task_completed(self, task_id: str, output: Optional[str] = None) -> None:
        for t in self.tasks:
            if t["id"] == task_id:
                t["status"] = "completed"
                t["output"] = output
        await self.emit(AgentEvent(
            agent=self.name,
            event_type="task",
            task_id=task_id,
            task_name=self._task_name(task_id),
            task_status="completed",
            output={"summary": output} if output else None,
            timestamp=_now(),
        ))

    async def task_failed(self, task_id: str, error: str) -> None:
        for t in self.tasks:
            if t["id"] == task_id:
                t["status"] = "failed"
                t["output"] = error
        await self.emit(AgentEvent(
            agent=self.name,
            event_type="task",
            task_id=task_id,
            task_name=self._task_name(task_id),
            task_status="failed",
            message=error,
            timestamp=_now(),
        ))

    async def log(self, message: str) -> None:
        await self.emit(AgentEvent(
            agent=self.name,
            event_type="log",
            message=message,
            timestamp=_now(),
        ))

    async def progress(self, value: float) -> None:
        await self.emit(AgentEvent(
            agent=self.name,
            event_type="progress",
            progress=value,
            timestamp=_now(),
        ))

    async def completed(self, output: Optional[Dict[str, Any]] = None) -> None:
        await self.emit(AgentEvent(
            agent=self.name,
            event_type="completed",
            output=output,
            timestamp=_now(),
        ))
        await self.queue.put(None)  # sentinel to end stream

    async def failed(self, error: str) -> None:
        await self.emit(AgentEvent(
            agent=self.name,
            event_type="failed",
            message=error,
            timestamp=_now(),
        ))
        await self.queue.put(None)

    def _task_name(self, task_id: str) -> str:
        for t in self.tasks:
            if t["id"] == task_id:
                return t["name"]
        return task_id

    async def run(self) -> Dict[str, Any]:
        raise NotImplementedError
