from __future__ import annotations

import asyncio
from typing import Any, Dict

from backend.app.services.base import Agent
from backend.app.utils.session import get_session, update_session


class InventoryAgent(Agent):
    def __init__(self, session_id: str, queue: asyncio.Queue):
        super().__init__("inventory", session_id, queue)
        self._declare_tasks(
            [
                {"id": "list_models", "name": "List candidate models"},
                {"id": "score_model_eligibility", "name": "Score model eligibility"},
                {"id": "set_workflow_config", "name": "Set workflow config"},
            ]
        )

    async def run(self) -> Dict[str, Any]:
        session = get_session(self.session_id)
        if not session:
            await self.failed("Session not found")
            return {}
        await self.started()
        await self.task_started("list_models")
        await self.task_completed("list_models", "Model inventory available")
        await self.task_started("score_model_eligibility")
        selected = session.get("model_entry") or {}
        label = selected.get("model_name") or selected.get("model_id") or "No model selected"
        await self.task_completed("score_model_eligibility", str(label))
        await self.task_started("set_workflow_config")
        result = {
            "selected_model": selected,
            "inventory_metrics": session.get("drift_metrics") or [],
            "evaluation_metrics": session.get("evaluation_metrics") or [],
        }
        update_session(self.session_id, {"inception_result": result})
        await self.task_completed("set_workflow_config", "Inventory context captured")
        await self.completed(result)
        return result


class ExportAgent(Agent):
    def __init__(self, session_id: str, queue: asyncio.Queue):
        super().__init__("export", session_id, queue)
        self._declare_tasks(
            [
                {"id": "assemble_export_bundle", "name": "Assemble export bundle"},
                {"id": "generate_mrm_summary", "name": "Generate MRM summary"},
            ]
        )

    async def run(self) -> Dict[str, Any]:
        session = get_session(self.session_id)
        if not session:
            await self.failed("Session not found")
            return {}
        await self.started()
        await self.task_started("assemble_export_bundle")
        await self.task_completed("assemble_export_bundle", "Artifacts staged")
        await self.task_started("generate_mrm_summary")
        summary = {
            "model_promotion_status": (session.get("evaluation_result") or {}).get("model_promotion_status"),
            "selected_recommended_action": session.get("selected_recommended_action"),
        }
        update_session(self.session_id, {"export_result": summary})
        await self.task_completed("generate_mrm_summary", "Summary created")
        await self.completed(summary)
        return summary
