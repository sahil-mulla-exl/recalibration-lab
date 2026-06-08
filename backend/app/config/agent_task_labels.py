"""Agent stepper task titles — keep in sync with frontend AgentStepper DEFAULT_AGENT_TASKS."""

from backend.app.config.datasets import (
    ALL_DATASETS_PHRASE,
    DEV_DATA,
    HOLD_DATA,
    NEW_DATA,
    NEW_VALIDATION,
)

INGESTION_PARSE_DEV = f"Parse {DEV_DATA}"
INGESTION_PARSE_NEW = f"Parse {NEW_DATA}"
INGESTION_PARSE_HOLD = f"Parse {HOLD_DATA}"
INGESTION_REFINEMENT = f"Refinement — reconcile schemas ({ALL_DATASETS_PHRASE})"
INGESTION_PARSE_OOS = f"Parse {NEW_VALIDATION}"

REPRO_APPLY_PREPROCESSING = f"Apply preprocessing ({ALL_DATASETS_PHRASE})"
REPRO_APPLY_FEATURES = f"Apply feature engineering ({ALL_DATASETS_PHRASE})"
REPRO_SCORE_DEV = f"Score {DEV_DATA} with model"
REPRO_SCORE_NEW = f"Score {NEW_DATA} with model"
REPRO_SCORE_HOLD = f"Score {HOLD_DATA} with model"
REPRO_SCORE_OOS = f"Score {NEW_VALIDATION} with model"

RECAL_SCORE_OOT = f"Score {NEW_VALIDATION}"

EVAL_SCORE_HOLDOUTS = f"Score {HOLD_DATA} and {NEW_VALIDATION} (Existing + recalibrated)"
