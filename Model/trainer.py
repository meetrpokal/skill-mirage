"""
trainer.py — Train a LightGBM regression model to predict personal AI risk scores.

Since we don't have ground-truth displacement labels, we synthesise training
targets from the deterministic formula (L1 base + experience + write-up
adjustments).  The model learns the *non-linear* relationship so it can
generalise to unseen city/role combos and provide SHAP-based explanations.

Usage:
    python trainer.py                          # trains on Main_Naukri.csv
    python trainer.py --csv other.csv --save   # trains and saves model artefacts
"""

import argparse
import warnings
import os

import numpy as np
import pandas as pd
import joblib
import lightgbm as lgb
from sklearn.model_selection import KFold
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import shap

from pipeline import (
    preprocess,
    compute_l1_index,
    count_ai_mentions,
    count_manual_flags,
    detect_automation_signal,
    normalize_job_title,
    ROLE_THEORETICAL_BETA,
    AI_TOOLS,
    MANUAL_KEYWORDS,
)

warnings.filterwarnings("ignore")

# ──────────────────────────────────────────────
# 1.  SYNTHETIC TARGET GENERATION
# ──────────────────────────────────────────────

def _experience_adjustment(xp: float) -> float:
    """Deterministic experience adjustment (mirrors model.py logic)."""
    if np.isnan(xp):
        return 0.0
    if xp <= 2:
        return 10.0
    elif xp >= 10:
        return -20.0
    elif xp >= 7:
        return -10.0
    return 0.0


def _writeup_adjustment(ai_count: int, manual_count: int) -> float:
    """Deterministic write-up adjustment."""
    return -15 * ai_count + 10 * manual_count


def synthesise_targets(df: pd.DataFrame, l1: pd.DataFrame) -> pd.DataFrame:
    """Create per-posting synthetic risk scores as training targets.

    For each job posting we compute:
        target = clamp(base_l1 + xp_adj + writeup_adj + noise, 0, 100)

    This lets the model learn the signal structure while allowing SHAP to
    decompose predictions into meaningful feature contributions.
    """
    # Merge L1 base score onto each posting
    df = df.merge(
        l1[["Primary_City", "Normalized_Role", "AI_Vulnerability_Index"]],
        on=["Primary_City", "Normalized_Role"],
        how="left",
    )
    # Fallback for unmatched rows
    df["AI_Vulnerability_Index"] = df["AI_Vulnerability_Index"].fillna(
        df["Normalized_Role"].map(
            {k: int(v * 100) for k, v in ROLE_THEORETICAL_BETA.items()}
        )
    ).fillna(45)

    df["XP_Adj"]      = df["Experience_Mid"].apply(_experience_adjustment)
    df["Writeup_Adj"] = df.apply(
        lambda r: _writeup_adjustment(r["AI_Mentions"], r["Manual_Flags"]), axis=1
    )

    # Synthetic target with small Gaussian noise for regularisation
    rng = np.random.default_rng(42)
    noise = rng.normal(0, 3, size=len(df))
    df["Risk_Target"] = (
        df["AI_Vulnerability_Index"] + df["XP_Adj"] + df["Writeup_Adj"] + noise
    ).clip(0, 100).round(1)

    return df


# ──────────────────────────────────────────────
# 2.  FEATURE ENGINEERING
# ──────────────────────────────────────────────

FEATURE_COLS = [
    "Base_L1_Score",
    "Experience_Mid",
    "AI_Mentions",
    "Manual_Flags",
    "Automation_Weight",
    "Theoretical_Beta",
    "Role_Seniority",
    "Hiring_Intensity",     # proxy: total jobs for this city/role
]


def build_features(df: pd.DataFrame, l1: pd.DataFrame) -> pd.DataFrame:
    """Construct the feature matrix from preprocessed data."""
    # Merge L1 aggregates
    l1_cols = l1[["Primary_City", "Normalized_Role", "AI_Vulnerability_Index",
                   "Total_Jobs", "AI_Penetration_Pct"]].copy()
    l1_cols = l1_cols.rename(columns={
        "AI_Vulnerability_Index": "Base_L1_Score",
        "Total_Jobs": "Hiring_Intensity",
    })
    df = df.merge(l1_cols, on=["Primary_City", "Normalized_Role"], how="left")

    # Fill missing L1 data with role-level defaults
    df["Base_L1_Score"]   = df["Base_L1_Score"].fillna(
        df["Normalized_Role"].map(
            {k: int(v * 100) for k, v in ROLE_THEORETICAL_BETA.items()}
        )
    ).fillna(45)
    df["Hiring_Intensity"] = df["Hiring_Intensity"].fillna(0)

    # Theoretical beta
    df["Theoretical_Beta"] = df["Normalized_Role"].map(ROLE_THEORETICAL_BETA).fillna(0.45)

    # Role seniority heuristic (from experience midpoint)
    df["Role_Seniority"] = pd.cut(
        df["Experience_Mid"].fillna(3),
        bins=[0, 2, 5, 10, 50],
        labels=[1, 2, 3, 4],
    ).astype(float)

    # Fill remaining NaNs
    df["Experience_Mid"]    = df["Experience_Mid"].fillna(3.0)
    df["AI_Mentions"]       = df["AI_Mentions"].fillna(0)
    df["Manual_Flags"]      = df["Manual_Flags"].fillna(0)
    df["Automation_Weight"] = df["Automation_Weight"].fillna(0)

    return df


# ──────────────────────────────────────────────
# 3.  MODEL TRAINING
# ──────────────────────────────────────────────

def train_model(df: pd.DataFrame, n_folds: int = 5):
    """Train a LightGBM regressor with K-Fold cross-validation.

    Returns the best model and SHAP explainer.
    """
    X = df[FEATURE_COLS].values
    y = df["Risk_Target"].values

    lgb_params = {
        "objective": "regression",
        "metric": "mae",
        "learning_rate": 0.05,
        "num_leaves": 31,
        "max_depth": 6,
        "min_child_samples": 20,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
        "reg_alpha": 0.1,
        "reg_lambda": 1.0,
        "verbose": -1,
        "n_estimators": 500,
        # Monotonic constraints: [base_l1 ↑, exp ↓, ai_mentions ↓,
        #   manual_flags ↑, auto_wt ↑, theo_beta ↑, seniority ↓, hiring ↑]
        "monotone_constraints": [1, -1, -1, 1, 1, 1, -1, 1],
    }

    kf = KFold(n_splits=n_folds, shuffle=True, random_state=42)
    oof_preds = np.zeros(len(y))
    best_model = None
    best_score = np.inf

    print(f"\n[Trainer] {n_folds}-fold CV on {len(y):,} samples …")
    for fold, (train_idx, val_idx) in enumerate(kf.split(X), 1):
        X_tr, X_val = X[train_idx], X[val_idx]
        y_tr, y_val = y[train_idx], y[val_idx]

        model = lgb.LGBMRegressor(**lgb_params)
        model.fit(
            X_tr, y_tr,
            eval_set=[(X_val, y_val)],
            callbacks=[lgb.early_stopping(30, verbose=False)],
        )

        preds = model.predict(X_val).clip(0, 100)
        oof_preds[val_idx] = preds
        mae = mean_absolute_error(y_val, preds)
        print(f"  Fold {fold}: MAE = {mae:.2f}")

        if mae < best_score:
            best_score = mae
            best_model = model

    # Overall OOF metrics
    overall_mae = mean_absolute_error(y, oof_preds)
    overall_r2  = r2_score(y, oof_preds)
    print(f"\n[Trainer] OOF MAE  = {overall_mae:.2f}")
    print(f"[Trainer] OOF R²   = {overall_r2:.4f}")

    # SHAP explainer
    explainer = shap.TreeExplainer(best_model)

    return best_model, explainer, FEATURE_COLS


def save_artefacts(model, explainer, feature_names, out_dir="artefacts"):
    """Persist model and metadata to disk."""
    os.makedirs(out_dir, exist_ok=True)
    joblib.dump(model, os.path.join(out_dir, "lgb_risk_model.pkl"))
    joblib.dump(explainer, os.path.join(out_dir, "shap_explainer.pkl"))
    joblib.dump(feature_names, os.path.join(out_dir, "feature_names.pkl"))
    print(f"[Trainer] Artefacts saved to {out_dir}/")


# ──────────────────────────────────────────────
# 4.  CLI
# ──────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Train personal AI risk model")
    parser.add_argument("--csv", default="Main_Naukri.csv")
    parser.add_argument("--min-jobs", type=int, default=5)
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--save", action="store_true", help="Save model artefacts")
    args = parser.parse_args()

    # 1. Run pipeline
    df = pd.read_csv(args.csv)
    df_clean = preprocess(df)
    l1 = compute_l1_index(df_clean, min_jobs=args.min_jobs)

    # 2. Synthesise targets
    df_train = synthesise_targets(df_clean, l1)

    # 3. Build features
    df_train = build_features(df_train, l1)

    # 4. Train
    model, explainer, feat_names = train_model(df_train, n_folds=args.folds)

    # 5. Feature importance
    print("\n[Trainer] Feature importances (gain):")
    for name, imp in sorted(
        zip(feat_names, model.feature_importances_), key=lambda x: -x[1]
    ):
        print(f"  {name:25s}  {imp:10.0f}")

    # 6. Optionally save
    if args.save:
        save_artefacts(model, explainer, feat_names)
        l1.to_csv("l1_vulnerability.csv", index=False)
        print("[Trainer] L1 table saved to l1_vulnerability.csv")

    return model, explainer, l1


if __name__ == "__main__":
    main()
