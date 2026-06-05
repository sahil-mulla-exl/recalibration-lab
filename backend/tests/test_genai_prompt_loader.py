from backend.app.services.genai_prompt_loader import (
    get_llm_context,
    list_prompt_ids,
    load_system_prompt,
)


def test_manifest_lists_expected_prompts():
    ids = list_prompt_ids()
    for expected in (
        "performance_drift",
        "data_drift",
        "concept_drift",
        "recalibration_decision",
        "evaluation",
    ):
        assert expected in ids


def test_load_performance_drift_prompt():
    text = load_system_prompt("performance_drift")
    assert "MODEL DISCRIMINATION" in text
    assert len(text) > 200


def test_llm_context_from_manifest():
    assert get_llm_context("evaluation") == "evaluation"
    assert get_llm_context("data_drift") == "drift_diagnostics"
