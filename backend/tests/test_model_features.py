import joblib
from xgboost import XGBClassifier

from backend.app.utils.model_features import (
    load_model_feature_names_from_session,
    resolve_session_model_features,
)
from backend.app.utils.model_helpers import extract_model_feature_names
import pandas as pd


def test_load_features_from_session_cache() -> None:
    session = {
        "uploaded_model_feature_names": ["feat_a", "feat_b"],
        "reproducibility_result": {"model_features_used": ["feat_x"]},
    }
    assert load_model_feature_names_from_session(session) == ["feat_x"]


def test_resolve_intersects_dataframe_columns() -> None:
    session = {"uploaded_model_feature_names": ["a", "b", "c"]}
    df = pd.DataFrame({"a": [1], "b": [2], "score": [0.5]})
    cols = resolve_session_model_features(session, df, exclude={"score"})
    assert cols == ["a", "b"]


def test_extract_from_pkl(tmp_path) -> None:
    model = XGBClassifier(n_estimators=10, verbosity=0)
    X = pd.DataFrame({"feat_a": [0, 1], "feat_b": [1, 0]})
    model.fit(X, [0, 1])
    path = tmp_path / "m.pkl"
    joblib.dump(model, path)
    names = extract_model_feature_names(joblib.load(path))
    assert names == ["feat_a", "feat_b"]
