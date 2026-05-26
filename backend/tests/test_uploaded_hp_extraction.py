import os

import joblib
from xgboost import XGBClassifier

from backend.app.services.recalibration_agent import (
    _clean_training_params,
    _extract_base_params_from_uploaded_model,
)
from backend.app.utils.model_helpers import extract_training_hyperparameters


def test_extract_xgboost_hp_filters_none_defaults(tmp_path) -> None:
    model = XGBClassifier(
        n_estimators=200,
        max_depth=4,
        learning_rate=0.05,
        random_state=42,
        eval_metric="auc",
        verbosity=0,
    )
    model.fit([[0.0, 1.0], [1.0, 0.0], [0.5, 0.5]], [0, 1, 0])
    path = tmp_path / "model.pkl"
    joblib.dump(model, path)

    raw = _extract_base_params_from_uploaded_model(str(path), "xgboost")
    cleaned = _clean_training_params(raw)

    assert cleaned["n_estimators"] == 200
    assert cleaned["max_depth"] == 4
    assert cleaned["learning_rate"] == 0.05
    assert "subsample" not in cleaned
    assert "colsample_bytree" not in cleaned


def test_extract_from_dict_wrapper(tmp_path) -> None:
    model = XGBClassifier(n_estimators=120, max_depth=3, learning_rate=0.1, verbosity=0)
    model.fit([[0.0], [1.0], [0.5]], [0, 1, 0])
    wrapped = {
        "model": model,
        "hyperparameters": {
            "n_estimators": 120,
            "max_depth": 3,
            "learning_rate": 0.1,
            "subsample": 0.85,
        },
    }
    path = tmp_path / "wrapped.pkl"
    joblib.dump(wrapped, path)

    keys = {"n_estimators", "max_depth", "learning_rate", "subsample", "colsample_bytree"}
    params = extract_training_hyperparameters(joblib.load(path), keys)
    assert params["n_estimators"] == 120
    assert params["subsample"] == 0.85
