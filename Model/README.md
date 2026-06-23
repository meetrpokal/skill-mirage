# AI Vulnerability Scoring System

An end-to-end pipeline that scores **job market AI vulnerability** (city × role) and **personal AI displacement risk** (individual workers) using the Anthropic labor-exposure methodology.

---

## Architecture

```
Main_Naukri.csv  →  pipeline.py  →  L1 Vulnerability Table (city, role, index)
                                          ↓
                    trainer.py   →  LightGBM model + SHAP explainer
                                          ↓
                    scoring_api.py → Personal Risk Score (0-100) + explanation
```

### Layer 1 — Market Vulnerability Index
Computes an **AI_Vulnerability_Index (0-100)** for each (city, role) pair:

| Signal | Weight | Source |
|--------|--------|--------|
| Observed exposure (AI penetration in postings) | 0.55 | Job skills / JD keywords |
| Theoretical exposure β (Eloundou-style) | 0.30 | Role-level heuristic mapping |
| Static role baseline | 0.15 | Domain expertise prior |

Automation vs augmentation keywords shift the observed exposure (auto=1.0, aug=0.5).

### Layer 2 — Personal Risk Score
A **LightGBM regressor** predicts a 0-100 risk score from 8 features:

| Feature | Monotonic constraint |
|---------|---------------------|
| Base L1 vulnerability | ↑ higher base → higher risk |
| Years of experience | ↓ more exp → lower risk |
| AI tool mentions (write-up) | ↓ more AI skills → lower risk |
| Manual task flags (write-up) | ↑ more manual → higher risk |
| Automation weight | ↑ |
| Theoretical β | ↑ |
| Role seniority | ↓ |
| Hiring intensity (city/role) | ↑ |

SHAP values decompose each prediction into feature contributions.

---

## Quick Start

```bash
# 1. Install dependencies
pip install pandas scikit-learn lightgbm shap nltk joblib

# macOS only: LightGBM needs OpenMP
brew install libomp

# 2. Run the L1 pipeline
python pipeline.py --csv Main_Naukri.csv

# 3. Train the personal risk model
python trainer.py --save

# 4. Score worker profiles
python scoring_api.py
```

---

## Output Formats

### Market Vulnerability Table (`l1_vulnerability.csv`)
| Column | Description |
|--------|-------------|
| Primary_City | Normalised city name |
| Normalized_Role | Canonical role bucket |
| Total_Jobs | Number of postings |
| AI_Penetration_Pct | % of postings mentioning AI tools |
| Observed_Exposure_Adj | Blended observed exposure (0-1) |
| Theoretical_Exposure | Role-level β (0-1) |
| AI_Vulnerability_Index | Final score (0-100) |

### Personal Risk Score (API response)
```json
{
  "final_risk_score": 88,
  "category": "CRITICAL RISK",
  "base_l1_vulnerability": 87,
  "component_adjustments": {
    "experience_adj": 10,
    "ai_skill_adj": -15,
    "manual_flags_adj": 20
  },
  "top_features": [
    {"feature": "Base_L1_Score", "shap_value": 54.9, "raw_value": 87.0},
    {"feature": "Manual_Flags", "shap_value": 17.0, "raw_value": 5.0}
  ],
  "confidence_std": 1.23,
  "reskilling": {
    "target_roles": ["data analyst", "RPA developer"],
    "courses": [{"name": "AI for Everyone (NPTEL)", "weeks": 4}]
  }
}
```

### Risk Categories
| Range | Category |
|-------|----------|
| 75-100 | CRITICAL RISK |
| 50-74 | HIGH RISK |
| 25-49 | MODERATE RISK |
| 0-24 | LOW RISK |

---

## File Structure

```
pipeline.py       — Data ingestion, cleaning, feature extraction, L1 index
trainer.py        — LightGBM training, cross-validation, SHAP explainer
scoring_api.py    — Personal risk scoring API with deterministic fallback
model.py          — Original baseline implementation (preserved)
prompt.xml        — Full system specification
artefacts/        — Saved model, explainer, feature names (after training)
```

## Methodology Notes

- **Coefficients** (0.55 / 0.30 / 0.15) are tunable in `pipeline.py` config section
- **Theoretical β** values approximate the Eloundou task-exposure mapping; substitute O\*NET mappings when available
- The model uses **monotonic constraints** to enforce domain logic (e.g., more AI skills always reduces risk)
- **Deterministic fallback** handles cold-start cities with no L1 data
