import os
import re
import joblib
import pandas as pd
import numpy as np
from typing import Any, Dict, Optional, Tuple


CATEGORICAL_COLS = ["income_band", "age_band", "geo_region", "customer_segment", "credit_score_band"]
NUMERIC_COLS = [
    "tenure_months", "card_count", "avg_balance_3m", "utilization_pct",
    "last_offer_response", "digital_engagement_score", "email_open_rate_30d",
    "web_visits_60d", "app_logins_30d", "branch_visits_90d",
    "cross_sell_count", "delinquency_30d", "relationship_value_score",
]
FEATURE_COLS = NUMERIC_COLS + CATEGORICAL_COLS
TARGET_COL = "responded_to_offer"


def load_model(model_path: str) -> Any:
    return joblib.load(model_path)


def resolve_estimator(model_obj: Any) -> Any:
    """Unwrap common containers and return the scoring estimator."""
    model = model_obj

    if isinstance(model, dict):
        for key in ("model", "estimator", "clf", "regressor", "classifier", "pipeline"):
            candidate = model.get(key)
            if candidate is not None:
                model = candidate
                break
        else:
            for candidate in model.values():
                if hasattr(candidate, "predict") or hasattr(candidate, "predict_proba"):
                    model = candidate
                    break

    if hasattr(model, "named_steps") and getattr(model, "named_steps", None):
        for step_name in ("clf", "reg", "model", "estimator", "classifier", "regressor"):
            if step_name in model.named_steps:
                model = model.named_steps[step_name]
                break
        else:
            # Fallback to terminal step.
            try:
                model = list(model.named_steps.values())[-1]
            except Exception:
                pass

    return model


def extract_model_feature_names(model_obj: Any) -> list[str]:
    """Return feature names stored on the serialized model (.pkl)."""
    model = resolve_estimator(model_obj)
    if hasattr(model, "feature_names_in_"):
        try:
            return [str(c) for c in list(model.feature_names_in_)]
        except Exception:
            pass
    if hasattr(model, "get_booster"):
        try:
            names = model.get_booster().feature_names
            if names:
                return [str(c) for c in list(names)]
        except Exception:
            pass
    return []


def _is_usable_hp_value(value: Any) -> bool:
    if value is None:
        return False
    try:
        if isinstance(value, float) and np.isnan(value):
            return False
    except Exception:
        pass
    return True


def extract_training_hyperparameters(model_obj: Any, supported_keys: set[str]) -> Dict[str, Any]:
    """
    Read hyperparameters from a serialized model (.pkl) for recalibration without HP search.
    Supports sklearn estimators, pipelines, and dict wrappers with metadata keys.
    """
    alias_map = {
        "feature_fraction": "colsample_bytree",
        "bagging_fraction": "subsample",
    }
    metadata_keys = (
        "hyperparameters",
        "hyper_params",
        "best_params",
        "params",
        "hp_params",
        "model_params",
    )
    collected: Dict[str, Any] = {}

    if isinstance(model_obj, dict):
        for meta_key in metadata_keys:
            raw = model_obj.get(meta_key)
            if isinstance(raw, dict):
                for key, value in raw.items():
                    out_key = alias_map.get(key, key)
                    if out_key in supported_keys and _is_usable_hp_value(value):
                        collected[out_key] = value

    estimator = resolve_estimator(model_obj)
    if hasattr(estimator, "get_params"):
        for key, value in estimator.get_params(deep=True).items():
            out_key = alias_map.get(key, key)
            if out_key in supported_keys and _is_usable_hp_value(value):
                collected[out_key] = value

    return collected


def extract_model_metadata(model_obj: Any) -> Dict[str, Any]:
    model = resolve_estimator(model_obj)
    meta: Dict[str, Any] = {
        "model_class": type(model).__name__,
    }

    feature_names = extract_model_feature_names(model_obj)
    if feature_names:
        meta["feature_count"] = int(len(feature_names))
    elif hasattr(model, "feature_names_in_"):
        try:
            meta["feature_count"] = int(len(model.feature_names_in_))
        except Exception:
            pass
    elif hasattr(model, "get_booster"):
        try:
            names = model.get_booster().feature_names
            if names:
                meta["feature_count"] = int(len(names))
        except Exception:
            pass
    if "feature_count" not in meta and hasattr(model, "n_features_in_"):
        try:
            n = int(model.n_features_in_)
            if n > 0:
                meta["feature_count"] = n
        except Exception:
            pass
    if "feature_count" not in meta and hasattr(model, "get_booster"):
        try:
            booster = model.get_booster()
            if hasattr(booster, "num_features"):
                n = int(booster.num_features())
                if n > 0:
                    meta["feature_count"] = n
        except Exception:
            pass
    if "feature_count" not in meta and isinstance(model_obj, dict):
        for key in ("feature_names", "features", "model_features", "feature_columns"):
            raw = model_obj.get(key)
            if isinstance(raw, (list, tuple)) and raw:
                meta["feature_count"] = int(len(raw))
                break

    if hasattr(model, "n_estimators"):
        try:
            meta["n_estimators"] = int(model.n_estimators)
        except Exception:
            pass

    return meta


def save_model(model: Any, path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    joblib.dump(model, path)


def encode_categoricals(df: pd.DataFrame, categorical_cols: list[str] | None = None) -> pd.DataFrame:
    """One-hot encode categorical columns (inferred from dtypes when not specified)."""
    out = df.copy()
    # Drop duplicate column labels defensively (keeps first occurrence).
    out = out.loc[:, ~out.columns.duplicated()]

    if categorical_cols is None:
        categorical_cols = [
            str(c)
            for c in out.select_dtypes(include=["object", "category", "bool"]).columns
        ]
    if categorical_cols:
        out = pd.get_dummies(out, columns=categorical_cols, drop_first=False)
    out = sanitize_feature_names(out)
    return out


def sanitize_feature_names(df: pd.DataFrame) -> pd.DataFrame:
    """
    Normalize feature names to be model-safe (especially for XGBoost):
    - force string names
    - replace unsupported characters (including [, ], <, >) with underscore
    - deduplicate after normalization
    """
    out = df.copy()
    raw_cols = [str(c) for c in out.columns]
    cleaned = [re.sub(r"[^0-9A-Za-z_]+", "_", c) for c in raw_cols]
    cleaned = [re.sub(r"_+", "_", c).strip("_") or "col" for c in cleaned]

    seen: Dict[str, int] = {}
    deduped: list[str] = []
    for c in cleaned:
        count = seen.get(c, 0)
        if count == 0:
            deduped.append(c)
        else:
            deduped.append(f"{c}_{count}")
        seen[c] = count + 1
    out.columns = deduped
    return out


def align_columns(df: pd.DataFrame, reference_columns: list) -> pd.DataFrame:
    """Align DataFrame columns to match reference (add missing as 0, drop extras)."""
    aligned = df.reindex(columns=reference_columns, fill_value=0)
    # Defragment after wide reindex (avoids PerformanceWarning from repeated insert).
    return aligned.copy()


def get_feature_columns(df: pd.DataFrame) -> list:
    """Get all feature columns (excluding target)."""
    return [c for c in df.columns if c != TARGET_COL]


def _prepare_model_matrix(
    model: Any,
    df_work: pd.DataFrame,
    feature_cols: Optional[list],
    *,
    skip_model_encoding: bool,
) -> pd.DataFrame:
    """Build feature matrix for predict/predict_proba."""
    if feature_cols is None:
        feature_cols = [c for c in df_work.columns if c != TARGET_COL]

    X = df_work.loc[:, feature_cols].copy()
    X = X.loc[:, ~X.columns.duplicated()]

    if skip_model_encoding:
        return X.apply(pd.to_numeric, errors="coerce").fillna(0.0)

    df_enc = encode_categoricals(X)
    if hasattr(model, "feature_names_in_"):
        model_cols = list(model.feature_names_in_)
        df_enc = align_columns(df_enc, model_cols)
    elif hasattr(model, "get_booster"):
        model_cols = model.get_booster().feature_names
        if model_cols:
            df_enc = align_columns(df_enc, model_cols)
    return df_enc


def score_dataframe(
    model: Any,
    df: pd.DataFrame,
    feature_cols: Optional[list] = None,
    *,
    skip_model_encoding: bool = False,
) -> np.ndarray:
    """Score a DataFrame with the model, optionally applying encode/align steps."""
    model = resolve_estimator(model)
    df_work = df.copy()
    df_work = df_work.loc[:, ~df_work.columns.duplicated()]
    df_enc = _prepare_model_matrix(
        model, df_work, feature_cols, skip_model_encoding=skip_model_encoding
    )

    if hasattr(model, "predict_proba"):
        return model.predict_proba(df_enc)[:, 1]
    preds = model.predict(df_enc)
    return np.asarray(preds, dtype=float)


def predict_dataframe(
    model: Any,
    df: pd.DataFrame,
    feature_cols: Optional[list] = None,
    *,
    skip_model_encoding: bool = False,
) -> np.ndarray:
    """Generate model predictions using native model.predict."""
    model = resolve_estimator(model)
    df_work = df.copy()
    df_work = df_work.loc[:, ~df_work.columns.duplicated()]
    df_enc = _prepare_model_matrix(
        model, df_work, feature_cols, skip_model_encoding=skip_model_encoding
    )
    preds = model.predict(df_enc)
    return np.asarray(preds)


def get_feature_importance(model: Any, feature_cols: list) -> Dict[str, float]:
    """Extract feature importances from model."""
    if hasattr(model, 'feature_importances_'):
        importances = model.feature_importances_
        if hasattr(model, 'feature_names_in_'):
            names = list(model.feature_names_in_)
        else:
            names = feature_cols
        return dict(zip(names, importances.tolist()))
    return {}


def get_xgboost_native_importance(
    model_obj: Any,
    feature_cols: list[str] | None,
    importance_type: str,
) -> Dict[str, float]:
    """
    Extract native XGBoost feature importance by type (gain/weight/cover).

    Returns a dense mapping for all known model features, filling missing
    features with 0.0 when the booster omits them from get_score().
    """
    model = resolve_estimator(model_obj)
    if not hasattr(model, "get_booster"):
        return {}

    try:
        booster = model.get_booster()
        raw_scores = booster.get_score(importance_type=importance_type) or {}
    except Exception:
        return {}

    booster_names = [str(c) for c in (getattr(booster, "feature_names", None) or [])]
    model_names: list[str] = []
    if hasattr(model, "feature_names_in_"):
        try:
            model_names = [str(c) for c in list(model.feature_names_in_)]
        except Exception:
            model_names = []
    fallback_names = [str(c) for c in (feature_cols or [])]

    def _name_for_index(idx: int) -> str:
        if idx < len(booster_names) and booster_names[idx]:
            return booster_names[idx]
        if idx < len(model_names) and model_names[idx]:
            return model_names[idx]
        if idx < len(fallback_names) and fallback_names[idx]:
            return fallback_names[idx]
        return f"f{idx}"

    out: Dict[str, float] = {}
    for raw_key, raw_value in raw_scores.items():
        key = str(raw_key)
        feature_name = key
        match = re.fullmatch(r"f(\d+)", key)
        if match:
            feature_name = _name_for_index(int(match.group(1)))
        try:
            out[str(feature_name)] = float(raw_value)
        except Exception:
            continue

    ordered_features: list[str] = []
    for name in [*booster_names, *model_names, *fallback_names]:
        if name and name not in ordered_features:
            ordered_features.append(name)
    for name in ordered_features:
        out.setdefault(name, 0.0)

    return out


def build_xgboost_importance_comparison(
    orig_imp: Dict[str, float],
    new_imp: Dict[str, float],
    features: list[str] | None,
) -> list[Dict[str, Any]]:
    """Build per-feature rank comparison rows across champion/recalibrated models."""
    feature_list: list[str] = []
    for feat in [*(features or []), *orig_imp.keys(), *new_imp.keys()]:
        f = str(feat)
        if f and f not in feature_list:
            feature_list.append(f)

    def _rank_map(values: Dict[str, float]) -> Dict[str, int]:
        ordered = sorted(
            feature_list,
            key=lambda name: (-float(values.get(name, 0.0)), name),
        )
        return {name: idx + 1 for idx, name in enumerate(ordered)}

    champion_rank = _rank_map(orig_imp)
    recal_rank = _rank_map(new_imp)

    rows: list[Dict[str, Any]] = []
    for feat in feature_list:
        champ_val = float(orig_imp.get(feat, 0.0))
        recal_val = float(new_imp.get(feat, 0.0))
        row = {
            "feature": feat,
            "champion_importance": champ_val,
            "recal_importance": recal_val,
            "champion_rank": champion_rank.get(feat, len(feature_list)),
            "recal_rank": recal_rank.get(feat, len(feature_list)),
        }
        row["rank_delta"] = int(row["champion_rank"]) - int(row["recal_rank"])
        rows.append(row)

    rows.sort(
        key=lambda r: (
            int(r["recal_rank"]),
            int(r["champion_rank"]),
            str(r["feature"]),
        ),
    )
    return rows


def train_xgboost(X_train: pd.DataFrame, y_train: pd.Series, params: Dict) -> Any:
    from xgboost import XGBClassifier
    n_jobs = int(params.get("n_jobs", 1))
    model = XGBClassifier(
        n_estimators=params.get("n_estimators", 100),
        max_depth=params.get("max_depth", 4),
        learning_rate=params.get("learning_rate", 0.1),
        subsample=params.get("subsample", 0.8),
        colsample_bytree=params.get("colsample_bytree", 0.8),
        random_state=42,
        eval_metric="auc",
        tree_method="hist",
        verbosity=0,
        n_jobs=max(1, n_jobs),
    )
    model.fit(X_train, y_train)
    return model


def train_lightgbm(X_train: pd.DataFrame, y_train: pd.Series, params: Dict) -> Any:
    from lightgbm import LGBMClassifier
    n_jobs = int(params.get("n_jobs", 1))
    model = LGBMClassifier(
        n_estimators=params.get("n_estimators", 100),
        max_depth=params.get("max_depth", 4),
        learning_rate=params.get("learning_rate", 0.1),
        subsample=params.get("subsample", 0.8),
        colsample_bytree=params.get("colsample_bytree", 0.8),
        random_state=42,
        verbose=-1,
        n_jobs=max(1, n_jobs),
    )
    model.fit(X_train, y_train)
    return model


def train_logistic(X_train: pd.DataFrame, y_train: pd.Series, params: Dict) -> Any:
    from sklearn.linear_model import LogisticRegression
    from sklearn.preprocessing import StandardScaler
    from sklearn.pipeline import Pipeline
    n_jobs = int(params.get("n_jobs", 1))
    model = Pipeline([
        ("scaler", StandardScaler()),
        ("clf", LogisticRegression(
            C=params.get("C", 1.0),
            max_iter=1000,
            random_state=42,
            n_jobs=max(1, n_jobs),
        )),
    ])
    model.fit(X_train, y_train)
    return model


def train_xgboost_regressor(X_train: pd.DataFrame, y_train: pd.Series, params: Dict) -> Any:
    from xgboost import XGBRegressor
    n_jobs = int(params.get("n_jobs", 1))
    model = XGBRegressor(
        n_estimators=params.get("n_estimators", 100),
        max_depth=params.get("max_depth", 4),
        learning_rate=params.get("learning_rate", 0.1),
        subsample=params.get("subsample", 0.8),
        colsample_bytree=params.get("colsample_bytree", 0.8),
        random_state=42,
        objective="reg:squarederror",
        tree_method="hist",
        verbosity=0,
        n_jobs=max(1, n_jobs),
    )
    model.fit(X_train, y_train)
    return model


def train_lightgbm_regressor(X_train: pd.DataFrame, y_train: pd.Series, params: Dict) -> Any:
    from lightgbm import LGBMRegressor
    n_jobs = int(params.get("n_jobs", 1))
    model = LGBMRegressor(
        n_estimators=params.get("n_estimators", 100),
        max_depth=params.get("max_depth", 4),
        learning_rate=params.get("learning_rate", 0.1),
        subsample=params.get("subsample", 0.8),
        colsample_bytree=params.get("colsample_bytree", 0.8),
        random_state=42,
        verbose=-1,
        n_jobs=max(1, n_jobs),
    )
    model.fit(X_train, y_train)
    return model


def train_linear_regression(X_train: pd.DataFrame, y_train: pd.Series) -> Any:
    from sklearn.linear_model import LinearRegression
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler
    model = Pipeline([
        ("scaler", StandardScaler()),
        ("reg", LinearRegression()),
    ])
    model.fit(X_train, y_train)
    return model


def train_model(
    model_class: str,
    X_train: pd.DataFrame,
    y_train: pd.Series,
    params: Dict,
    problem_type: str = "classification",
) -> Any:
    cls = model_class.lower()
    is_regression = (problem_type or "").lower().startswith("reg")
    if is_regression:
        if "xgb" in cls:
            return train_xgboost_regressor(X_train, y_train, params)
        if "lgbm" in cls or "lightgbm" in cls or "light" in cls:
            return train_lightgbm_regressor(X_train, y_train, params)
        return train_linear_regression(X_train, y_train)

    if "xgb" in cls:
        return train_xgboost(X_train, y_train, params)
    if "lgbm" in cls or "lightgbm" in cls or "light" in cls:
        return train_lightgbm(X_train, y_train, params)
    if "logistic" in cls or "lr" in cls:
        return train_logistic(X_train, y_train, params)
    return train_xgboost(X_train, y_train, params)
