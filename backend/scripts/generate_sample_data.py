"""
Generate all sample data for Recalibration Lab.
Run once to populate /data directory.
Seed: 42 for reproducibility.
"""
import os
import sys
import numpy as np
import pandas as pd
import joblib

SEED = 42
rng = np.random.default_rng(SEED)

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
os.makedirs(DATA_DIR, exist_ok=True)


# ─── 1. Sample inventory CSV ─────────────────────────────────────────────────
def gen_inventory():
    rows = [
        ("Card Acquisition Response v2.3", "MKT-CARD-RESP-023", "XGBoost", "Response", "M. Kumar", "2024-05-12", "2024-05-12", "s3://prod/scores/card_resp/", "bayesian"),
        ("Personal Loan Propensity v1.8", "MKT-LOAN-PROP-018", "LightGBM", "Propensity", "A. Sharma", "2024-09-03", "2024-09-03", "s3://prod/scores/loan_prop/", "random"),
        ("Mortgage Cross-sell v3.1", "MKT-MTG-XSELL-031", "Logistic", "Cross-sell", "P. Singh", "2024-11-21", "2024-11-21", "s3://prod/scores/mtg_xs/", "grid"),
        ("Auto Loan Response v2.1", "MKT-AUTO-RESP-021", "XGBoost", "Response", "R. Iyer", "2024-02-18", "2024-02-18", "s3://prod/scores/auto_resp/", "bayesian"),
        ("Insurance Churn Predictor v4.0", "INS-CHURN-040", "GBM", "Churn", "S. Mehta", "2024-07-30", "2024-07-30", "s3://prod/scores/ins_churn/", "random"),
        ("Credit Card Activation v1.4", "MKT-CC-ACT-014", "LightGBM", "Response", "V. Rao", "2024-10-09", "2024-10-09", "s3://prod/scores/cc_act/", "bayesian"),
    ]
    cols = ["model_name", "model_id", "model_class", "use_case", "owner",
            "deployment_date", "last_refit_date", "scoring_path", "optimization_method"]
    df = pd.DataFrame(rows, columns=cols)
    path = os.path.join(DATA_DIR, "sample_inventory.csv")
    df.to_csv(path, index=False)
    print(f"  ✓ inventory: {path}")
    return df


# ─── 2. Dev sample data ───────────────────────────────────────────────────────
def gen_dev_data(n: int = 50000) -> pd.DataFrame:
    np.random.seed(SEED)

    df = pd.DataFrame()
    df["tenure_months"]           = np.random.randint(1, 121, n)
    df["card_count"]              = np.random.randint(0, 9, n)
    df["avg_balance_3m"]          = np.random.lognormal(mean=8.5, sigma=1.2, size=n).clip(0, 500000)
    df["utilization_pct"]         = np.random.beta(2, 5, n).clip(0, 1)
    df["last_offer_response"]     = (np.random.random(n) < 0.12).astype(int)
    df["digital_engagement_score"]= np.random.beta(2, 3, n) * 100
    df["email_open_rate_30d"]     = np.random.beta(2, 4, n).clip(0, 1)
    df["web_visits_60d"]          = np.random.poisson(12, n)
    df["app_logins_30d"]          = np.random.poisson(8, n)
    df["branch_visits_90d"]       = np.random.poisson(2, n)
    df["cross_sell_count"]        = np.random.randint(0, 6, n)
    df["delinquency_30d"]         = (np.random.random(n) < 0.05).astype(int)
    df["relationship_value_score"]= np.random.beta(3, 4, n).clip(0, 1)

    # Categorical features
    df["income_band"]       = np.random.choice(["Low", "Mid", "High", "Premium"], n, p=[0.25, 0.40, 0.25, 0.10])
    df["age_band"]          = np.random.choice(["25-34", "35-44", "45-54", "55+"], n, p=[0.28, 0.32, 0.24, 0.16])
    df["geo_region"]        = np.random.choice(["North", "South", "East", "West", "Central"], n, p=[0.20, 0.22, 0.20, 0.18, 0.20])
    df["customer_segment"]  = np.random.choice(["New", "Growing", "Mature", "At-Risk"], n, p=[0.20, 0.35, 0.30, 0.15])
    df["credit_score_band"] = np.random.choice(["Sub", "Near", "Prime", "Super"], n, p=[0.15, 0.25, 0.40, 0.20])

    # Construct logistic target with realistic predictors
    # Intercept calibrated for ~9% base rate
    logit = (
        -7.3
        + 0.015 * df["tenure_months"]
        + 2.5  * df["utilization_pct"]
        + 0.038 * df["digital_engagement_score"]
        + 2.5  * df["relationship_value_score"]
        - 3.0  * df["delinquency_30d"]
        + 0.5  * df["last_offer_response"]
        + 0.9  * (df["income_band"] == "Premium").astype(float)
        + 0.4  * (df["income_band"] == "High").astype(float)
        - 0.4  * (df["income_band"] == "Low").astype(float)
        + 0.4  * (df["credit_score_band"] == "Super").astype(float)
        - 0.6  * (df["credit_score_band"] == "Sub").astype(float)
        + 0.3  * df["email_open_rate_30d"]
        + 0.02 * df["web_visits_60d"]
        + np.random.normal(0, 0.05, n)
    )
    prob = 1 / (1 + np.exp(-logit))
    df["responded_to_offer"] = (np.random.random(n) < prob).astype(int)

    actual_rate = df["responded_to_offer"].mean()
    print(f"  Dev target rate: {actual_rate*100:.2f}%")

    path = os.path.join(DATA_DIR, "dev_sample.parquet")
    df.to_parquet(path, index=False)
    print(f"  ✓ dev_sample: {path} ({len(df):,} rows)")
    return df


# ─── 3. New sample data (with engineered drift) ───────────────────────────────
def gen_new_data(dev_df: pd.DataFrame, n: int = 12400) -> pd.DataFrame:
    np.random.seed(SEED + 1)

    df = pd.DataFrame()
    df["tenure_months"]           = np.random.randint(1, 121, n)
    df["card_count"]              = np.random.randint(0, 9, n)
    df["avg_balance_3m"]          = np.random.lognormal(mean=8.5, sigma=1.2, size=n).clip(0, 500000)
    df["utilization_pct"]         = np.random.beta(2, 5, n).clip(0, 1)

    # DRIFT: last_offer_response — shift base rate (CSI ~0.28)
    df["last_offer_response"]     = (np.random.random(n) < 0.06).astype(int)  # was 0.12

    df["digital_engagement_score"]= np.random.beta(2, 3, n) * 100
    df["cross_sell_count"]        = np.random.randint(0, 6, n)
    df["delinquency_30d"]         = (np.random.random(n) < 0.05).astype(int)
    df["relationship_value_score"]= np.random.beta(3, 4, n).clip(0, 1)
    df["web_visits_60d"]          = np.random.poisson(12, n)

    # DRIFT: branch_visits_90d — channel shift (CSI ~0.42)
    df["branch_visits_90d"]       = np.random.poisson(0.6, n)  # was 2

    # DRIFT: app_logins_30d — mild shift (CSI ~0.18)
    df["app_logins_30d"]          = np.random.poisson(11, n)   # was 8

    # DRIFT: email_open_rate_30d — WoE shape distortion (CSI ~0.36)
    # Bimodal distribution instead of unimodal beta
    mask = np.random.random(n) < 0.5
    email_low  = np.random.beta(1, 8, n).clip(0, 1)
    email_high = np.random.beta(6, 2, n).clip(0, 1)
    df["email_open_rate_30d"] = np.where(mask, email_low, email_high)

    # Categorical
    df["income_band"]      = np.random.choice(["Low", "Mid", "High", "Premium"], n, p=[0.25, 0.40, 0.25, 0.10])
    df["age_band"]         = np.random.choice(["25-34", "35-44", "45-54", "55+"], n, p=[0.28, 0.32, 0.24, 0.16])

    # DRIFT: geo_region — significant category proportion shift (CSI ~0.27)
    df["geo_region"]       = np.random.choice(["North", "South", "East", "West", "Central"], n,
                                               p=[0.10, 0.35, 0.28, 0.07, 0.20])  # was 0.20/0.22/0.20/0.18/0.20

    df["customer_segment"] = np.random.choice(["New", "Growing", "Mature", "At-Risk"], n, p=[0.20, 0.35, 0.30, 0.15])
    df["credit_score_band"]= np.random.choice(["Sub", "Near", "Prime", "Super"], n, p=[0.15, 0.25, 0.40, 0.20])

    # Higher target rate (concept drift): 9% → ~10.6%
    logit = (
        -7.0  # slightly higher intercept → ~10.6% rate
        + 0.015 * df["tenure_months"]
        + 2.5  * df["utilization_pct"]
        + 0.038 * df["digital_engagement_score"]
        + 2.5  * df["relationship_value_score"]
        - 3.0  * df["delinquency_30d"]
        + 0.5  * df["last_offer_response"]
        + 0.9  * (df["income_band"] == "Premium").astype(float)
        + 0.4  * (df["income_band"] == "High").astype(float)
        - 0.4  * (df["income_band"] == "Low").astype(float)
        + 0.4  * (df["credit_score_band"] == "Super").astype(float)
        - 0.6  * (df["credit_score_band"] == "Sub").astype(float)
        + 0.3  * df["email_open_rate_30d"]
        + 0.02 * df["web_visits_60d"]
        + np.random.normal(0, 0.05, n)
    )
    prob = 1 / (1 + np.exp(-logit))
    df["responded_to_offer"] = (np.random.random(n) < prob).astype(int)

    actual_rate = df["responded_to_offer"].mean()
    print(f"  New target rate: {actual_rate*100:.2f}%")

    path = os.path.join(DATA_DIR, "new_sample.parquet")
    df.to_parquet(path, index=False)
    print(f"  ✓ new_sample: {path} ({len(df):,} rows)")
    return df


def gen_hold_data(new_df: pd.DataFrame, n: int = 8000) -> pd.DataFrame:
    """Create a dedicated holdout sample from new data distribution."""
    hold_df = new_df.sample(n=min(n, len(new_df)), random_state=SEED).reset_index(drop=True)
    path = os.path.join(DATA_DIR, "hold_sample.parquet")
    hold_df.to_parquet(path, index=False)
    print(f"  ✓ hold_sample: {path} ({len(hold_df):,} rows)")
    return hold_df


def gen_oos_data(new_df: pd.DataFrame, n: int = 6000) -> pd.DataFrame:
    """Create out-of-sample validation data (distinct from hold)."""
    oos_df = new_df.sample(n=min(n, len(new_df)), random_state=SEED + 7).reset_index(drop=True)
    path = os.path.join(DATA_DIR, "oos_sample.parquet")
    oos_df.to_parquet(path, index=False)
    print(f"  ✓ oos_sample: {path} ({len(oos_df):,} rows)")
    return oos_df


# ─── 4. Train XGBoost model ───────────────────────────────────────────────────
def train_model(dev_df: pd.DataFrame):
    from xgboost import XGBClassifier
    import sys
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
    from backend.app.utils.model_helpers import FEATURE_COLS, TARGET_COL, encode_categoricals

    feature_cols = [c for c in FEATURE_COLS if c in dev_df.columns]
    X = dev_df[feature_cols].copy()

    # Add engineered features
    X["engagement_x_tenure"] = X["digital_engagement_score"] * np.log1p(X["tenure_months"])
    X["util_squared"] = X["utilization_pct"] ** 2

    X_enc = encode_categoricals(X)
    y = dev_df[TARGET_COL].values

    # OOT split: last 20%
    split_idx = int(len(X_enc) * 0.8)
    X_train, X_oot = X_enc.iloc[:split_idx], X_enc.iloc[split_idx:]
    y_train, y_oot = y[:split_idx], y[split_idx:]

    model = XGBClassifier(
        n_estimators=200,
        max_depth=4,
        learning_rate=0.05,
        random_state=42,
        eval_metric="auc",
        verbosity=0,
    )
    model.fit(X_train, y_train)

    # Evaluate
    from sklearn.metrics import roc_auc_score
    oot_preds = model.predict_proba(X_oot)[:, 1]
    auc = roc_auc_score(y_oot, oot_preds)
    print(f"  Dev OOT AUC: {auc:.4f}")

    # Save model
    model_path = os.path.join(DATA_DIR, "card_response_v2.3.pkl")
    joblib.dump(model, model_path)
    print(f"  ✓ model: {model_path}")

    # Save dev scores (full dataset)
    all_preds = model.predict_proba(X_enc)[:, 1]
    scores_df = pd.DataFrame({"score": all_preds})
    scores_path = os.path.join(DATA_DIR, "dev_scores.parquet")
    scores_df.to_parquet(scores_path, index=False)
    print(f"  ✓ dev_scores: {scores_path}")

    return model


def generate_all():
    print("Generating Recalibration Lab sample data...")
    gen_inventory()
    dev_df = gen_dev_data()
    new_df = gen_new_data(dev_df)
    gen_hold_data(new_df)
    gen_oos_data(new_df)
    train_model(dev_df)
    print("✓ All sample data generated.")


if __name__ == "__main__":
    generate_all()
