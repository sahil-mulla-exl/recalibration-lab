# GenAI / LLM integration

This document describes where GenAI insights are wired, which prompt files to edit, and how calculation payloads reach the LLM.

## Overview

| Workflow | Prompt ID | Prompt file | Backend hook | Frontend surface |
|----------|-----------|-------------|--------------|------------------|
| Diagnostics — Performance | `performance_drift` | `backend/app/config/genai_prompts/performance_drift.md` | `drift_agent.py` → `assemble_report` | `PerfDriftTab` → `GenAiInsightsPanel` |
| Diagnostics — Data | `data_drift` | `data_drift.md` | same | `DataDriftTab` |
| Diagnostics — Concept | `concept_drift` | `concept_drift.md` | same | `ConceptDriftTab` |
| Diagnostics — Decision | `recalibration_decision` | `recalibration_decision.md` | same (after prior three) | `SummaryTab` / `FinalHitlPanel` |
| Evaluation | `evaluation` | `evaluation.md` | `evaluation_agent.py` end of `run()` | `Evaluation.tsx` |

Manifest (ids → files → LLM routing context): `backend/app/config/genai_prompts/prompts_manifest.json`.

Source specification (product copy): `GenAI_Capability.md` (developer input). Prompt text in this repo is derived from that document.

## Do not hardcode prompts in Python

- **System instructions** live only under `backend/app/config/genai_prompts/*.md`.
- **Loader**: `backend/app/services/genai_prompt_loader.py` — `load_system_prompt(prompt_id)`.
- **User message** is built in `genai_insights_service.py` as JSON calculation payload + fixed prefix (not the analytical rubric).

To add a new insight stream:

1. Add `your_prompt.md` under `genai_prompts/`.
2. Register it in `prompts_manifest.json` (`file`, `llm_context`, `wire_location`, `ui_location`).
3. Add a payload builder in `genai_payloads.py`.
4. Call `generate_insight("your_prompt_id", payload)` from the relevant agent or service.
5. Surface `report.genai_insights.your_prompt_id.text` in the UI via `GenAiInsightsPanel`.

## Runtime flow

```
Agent computes metrics → genai_payloads.build_*_payload(report)
                      → genai_insights_service.generate_insight(prompt_id, payload)
                      → genai_prompt_loader.load_system_prompt(prompt_id)
                      → llm_service.generate_text(..., context from manifest)
                      → stored on report.genai_insights[prompt_id]
```

Diagnostics runs prompts **sequentially** (performance → data → concept → recalibration decision) so concept and decision prompts can reference prior narrative excerpts.

Rule-based `recommendation.action` / `rationale` in diagnostics **unchanged**; GenAI adds narrative under `genai_insights` and does not replace governance rules unless you change that explicitly.

## Configuration

In `backend/.env` (see `backend/.env.example`):

```env
# Enable/disable insight generation (default: true)
LLM_INSIGHTS_ENABLED=true

# Primary: direct Azure OpenAI chat
LLM_CHAT_API_KEY=...
# Classic Azure OpenAI resource:
# LLM_CHAT_API_BASE=https://<resource>.openai.azure.com/
# Azure AI Foundry OpenAI-compatible v1 API (auto-detected; uses OpenAI provider in LiteLLM):
# AZURE_OPENAI_ENDPOINT=https://<project>.services.ai.azure.com/openai/v1
LLM_CHAT_API_VERSION=2025-01-01-preview
LLM_CHAT_MODEL=gpt-4.1-mini

# Fallback: corporate LiteLLM gateway (used when direct Azure fails)
LLM_GATEWAY_FALLBACK=true
LLM_GATEWAY_URL=...
LLM_GATEWAY_VIRTUAL_KEY=...

# Legacy gateway-only (skips direct Azure; default false)
LLM_USE_GATEWAY=false
```

**Routing order:** For each model candidate, the service tries **direct Azure first**, then **gateway fallback** (when `LLM_GATEWAY_FALLBACK=true`). Set `LLM_USE_GATEWAY=true` only if you want gateway-only (no direct Azure attempt).

Optional: `GENAI_PROMPTS_DIR` — override prompt directory path.

Model routing per context: `backend/app/core/llm_routing.py` (e.g. `drift_diagnostics`, `evaluation`).

Token/temperature profiles: `backend/app/core/llm_prompts.py`.

## Response shape

Each insight block on `drift_result` / `evaluation_result`:

```json
{
  "prompt_id": "performance_drift",
  "status": "ok | skipped | disabled | error",
  "text": "...",
  "error": null,
  "generated_at": "2026-06-03T12:00:00+00:00"
}
```

- `ok` — LLM returned text.
- `skipped` — LLM not configured.
- `disabled` — `LLM_INSIGHTS_ENABLED=false`.
- `error` — call failed; UI shows fallback message.

## Payload builders (what gets sent to the LLM)

| Prompt ID | Builder | Main inputs |
|-----------|---------|-------------|
| `performance_drift` | `build_performance_drift_payload` | AUC/KS/Gini, PSI, calibration error, ROB, classification deltas, SHAP flags |
| `data_drift` | `build_data_drift_payload` | Target drift, top CSI, cardinality, missing critical, segment hotspots |
| `concept_drift` | `build_concept_drift_payload` | IV decliners, univariate AUC, monotonicity breaks + prior stream excerpts |
| `recalibration_decision` | `build_recalibration_decision_payload` | `signal_grid`, rule recommendation, stream excerpts, compact summaries |
| `evaluation` | `build_evaluation_payload` | Three cohort metrics, deltas, rank order, lift D10, importance, guardrails |

Large artifacts (ROC curves, PDP grids, full lift tables) are **omitted** from payloads; only summary metrics are sent.

## Tests

```bash
cd backend && python -m pytest tests/test_genai_prompt_loader.py -q
```

## Re-run requirement

After changing prompts or payload shape, re-run **Diagnostics** and/or **Evaluation** agents so `genai_insights` is regenerated on the session report.
