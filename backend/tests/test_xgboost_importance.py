import pandas as pd
from sklearn.linear_model import LogisticRegression
from xgboost import XGBClassifier

from backend.app.utils.model_helpers import (
    build_xgboost_importance_comparison,
    get_xgboost_native_importance,
)


def _train_xgb() -> XGBClassifier:
    X = pd.DataFrame(
        {
            "f_income": [0.1, 0.4, 0.8, 0.2, 0.7, 0.5, 0.9, 0.3],
            "f_util": [0.9, 0.2, 0.1, 0.7, 0.3, 0.4, 0.2, 0.6],
            "f_tenure": [3, 12, 24, 6, 18, 9, 30, 15],
        }
    )
    y = [0, 0, 1, 0, 1, 0, 1, 1]
    model = XGBClassifier(
        n_estimators=40,
        max_depth=3,
        learning_rate=0.2,
        random_state=42,
        eval_metric="logloss",
        verbosity=0,
    )
    model.fit(X, y)
    return model


def test_get_xgboost_native_importance_returns_feature_names() -> None:
    model = _train_xgb()
    cols = ["f_income", "f_util", "f_tenure"]
    gain = get_xgboost_native_importance(model, cols, "gain")
    assert set(gain.keys()) == set(cols)
    assert any(v > 0 for v in gain.values())


def test_non_xgboost_estimator_returns_empty_dict() -> None:
    X = pd.DataFrame({"a": [0.0, 1.0, 0.5], "b": [1.0, 0.0, 0.5]})
    y = [0, 1, 0]
    model = LogisticRegression(max_iter=200)
    model.fit(X, y)
    imp = get_xgboost_native_importance(model, ["a", "b"], "gain")
    assert imp == {}


def test_build_comparison_produces_rank_delta() -> None:
    rows = build_xgboost_importance_comparison(
        {"a": 0.9, "b": 0.1},
        {"a": 0.2, "b": 0.8},
        ["a", "b"],
    )
    assert [r["feature"] for r in rows] == ["b", "a"]
    b_row = rows[0]
    assert b_row["champion_rank"] == 2
    assert b_row["recal_rank"] == 1
    assert b_row["rank_delta"] == 1
