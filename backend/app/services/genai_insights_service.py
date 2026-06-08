"""Generate GenAI narratives from diagnostic/evaluation payloads via LLMService."""
from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from backend.app.services.genai_payloads import (
    build_concept_drift_payload,
    build_data_drift_payload,
    build_evaluation_payload,
    build_performance_drift_payload,
    build_recalibration_decision_payload,
)
from backend.app.services.genai_prompt_loader import get_llm_context, load_system_prompt
from backend.app.services.llm_service import llm_service

_logger = logging.getLogger(__name__)

_USER_PREFIX = (
    "Below is the JSON output from the Recalibration Lab calculations for this workflow step. "
    "Produce insights strictly following your system instructions.\n"
    "Format each section with a banner line of equals signs, the section title, another banner line, "
    "then exactly 3-4 informative bullet points for that section only.\n"
    "Each bullet must cite a specific metric value or named signal from the payload.\n"
    "Do not echo system instructions, prompt text, or the JSON payload in your response.\n\n"
)


def insights_enabled() -> bool:
    raw = os.getenv("LLM_INSIGHTS_ENABLED", "true").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def _insight_result(
    prompt_id: str,
    *,
    status: str,
    text: str = "",
    error: Optional[str] = None,
) -> Dict[str, Any]:
    return {
        "prompt_id": prompt_id,
        "status": status,
        "text": text,
        "error": error,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


async def generate_insight(prompt_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    if not insights_enabled():
        return _insight_result(prompt_id, status="disabled", text="")
    if not llm_service.is_ready():
        return _insight_result(
            prompt_id,
            status="skipped",
            text="",
            error="AI is not configured. Re-run this agent after AI is configured in the backend.",
        )
    try:
        system_prompt = load_system_prompt(prompt_id)
        context = get_llm_context(prompt_id)
        user_content = _USER_PREFIX + json.dumps(payload, indent=2, default=str)
        text = await llm_service.generate_text(
            user_content,
            context=context,
            system_prompt=system_prompt,
        )
        if not text.strip():
            return _insight_result(prompt_id, status="error", error="empty AI response")
        return _insight_result(prompt_id, status="ok", text=text.strip())
    except Exception as exc:
        _logger.warning("GenAI insight failed for %s: %s", prompt_id, exc)
        return _insight_result(prompt_id, status="error", text="", error=str(exc))


async def enrich_diagnostics_report(report: Dict[str, Any]) -> Dict[str, Any]:
    """Run all diagnostics GenAI prompts; mutates and returns genai_insights dict."""
    perf_payload = build_performance_drift_payload(report)
    perf_insight = await generate_insight("performance_drift", perf_payload)

    data_payload = build_data_drift_payload(report)
    data_insight = await generate_insight("data_drift", data_payload)

    perf_text = perf_insight.get("text") if perf_insight.get("status") == "ok" else None
    data_text = data_insight.get("text") if data_insight.get("status") == "ok" else None
    concept_payload = build_concept_drift_payload(
        report,
        performance_summary=perf_text,
        data_drift_summary=data_text,
    )
    concept_insight = await generate_insight("concept_drift", concept_payload)

    # Decision prompt uses stream excerpts when available
    report_with_partial = dict(report)
    report_with_partial["genai_insights"] = {
        "performance_drift": perf_insight,
        "data_drift": data_insight,
        "concept_drift": concept_insight,
    }
    decision_payload = build_recalibration_decision_payload(report_with_partial)
    decision_insight = await generate_insight("recalibration_decision", decision_payload)

    return {
        "performance_drift": perf_insight,
        "data_drift": data_insight,
        "concept_drift": concept_insight,
        "recalibration_decision": decision_insight,
    }


async def enrich_evaluation_result(result: Dict[str, Any]) -> Dict[str, Any]:
    try:
        payload = build_evaluation_payload(result)
    except Exception as exc:
        _logger.warning("Evaluation GenAI payload build failed: %s", exc)
        return {
            "evaluation": _insight_result(
                "evaluation",
                status="error",
                text="",
                error=f"Failed to prepare evaluation metrics for AI: {exc}",
            ),
        }
    evaluation_insight = await generate_insight("evaluation", payload)
    return {"evaluation": evaluation_insight}


def enrich_diagnostics_report_sync(report: Dict[str, Any]) -> Dict[str, Any]:
    return asyncio.run(enrich_diagnostics_report(report))
