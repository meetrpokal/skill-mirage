"""
pipeline.py — End-to-end ingestion, cleaning, feature engineering, and
Layer 1 AI Vulnerability Index computation.

Methodology follows the Anthropic labor-exposure framework:
  - Observed exposure  = fraction of postings in a (city, role) that mention AI tools
  - Theoretical exposure = heuristic β per role (proxy for Eloundou task-level mapping)
  - Automation vs augmentation weighting (1.0 vs 0.5)
  - Final index = weighted combination, clamped to 0-100

Usage:
    python pipeline.py                       # runs on Main_Naukri.csv
    python pipeline.py --csv other_file.csv  # runs on a custom CSV
"""

import re
import argparse
import warnings
from datetime import datetime

import numpy as np
import pandas as pd
from nltk.stem import WordNetLemmatizer
import nltk

warnings.filterwarnings("ignore")

# Ensure NLTK data is available (one-time download)
for resource in ["wordnet", "omw-1.4"]:
    try:
        nltk.data.find(f"corpora/{resource}")
    except LookupError:
        nltk.download(resource, quiet=True)

# ──────────────────────────────────────────────
# 1.  CONFIGURATION — all tuneable knobs live here
# ──────────────────────────────────────────────

# Expanded AI-tool lexicon (order matters: longer phrases first to avoid partial matches)
AI_TOOLS = [
    "generative ai", "artificial intelligence", "machine learning",
    "deep learning", "robotic process automation", "natural language processing",
    "computer vision", "large language model",
    "genai", "chatgpt", "openai", "copilot", "midjourney", "stable diffusion",
    "langchain", "huggingface", "hugging face",
    "llm", "nlp", "rpa", "ai", "ml",
    "tensorflow", "pytorch", "keras", "scikit-learn", "xgboost", "lightgbm",
    "bert", "gpt", "transformer",
]

# Automation signal words (weight = 1.0 — full displacement potential)
AUTOMATION_KEYWORDS = [
    "automate", "automation", "automated", "fully automated",
    "robotic", "rpa", "reduce manual", "replace",
    "deploy", "production pipeline", "api", "batch process",
    "self-service", "no-code", "low-code",
]

# Augmentation signal words (weight = 0.5 — assists but doesn't replace)
AUGMENTATION_KEYWORDS = [
    "assist", "assistive", "support", "copilot", "tool",
    "use of llms", "drafting", "enhance", "productivity",
    "decision support", "recommendation", "insight",
]

# Manual / repetitive task keywords (indicates high displacement risk)
MANUAL_KEYWORDS = [
    "copy paste", "manual", "repetitive", "basic reporting",
    "data entry", "voice", "calls", "assistant", "analyst",
    "typing", "transcription", "back office", "clerical",
]

# Role → theoretical exposure β (proxy for Eloundou mapping, 0-1 scale)
# Higher β = higher fraction of tasks that *could* be automated by AI
ROLE_THEORETICAL_BETA = {
    "data entry":       0.92,
    "bpo":              0.88,
    "reporting":        0.75,
    "analyst":          0.65,
    "data professional":0.55,
    "manager":          0.35,
    "engineer":         0.25,
    "software engineer":0.22,
    "data scientist":   0.18,
    "machine learning": 0.10,
    "other":            0.45,
}

# Baseline role vulnerability (used as the "role_baseline" component, 0-1)
ROLE_BASELINE = {k: v for k, v in ROLE_THEORETICAL_BETA.items()}

# L1 index formula coefficients (calibrate on validation data)
COEFF_OBSERVED   = 0.55   # weight on observed AI penetration
COEFF_THEORETICAL = 0.30  # weight on theoretical exposure β
COEFF_BASELINE    = 0.15  # weight on static role baseline

# City alias normalisation
CITY_ALIASES = {
    "bengaluru": "Bangalore",
    "bangalore": "Bangalore",
    "gurugram": "Gurgaon",
    "gurgaon": "Gurgaon",
    "bombay": "Mumbai",
    "mumbai": "Mumbai",
    "madras": "Chennai",
    "chennai": "Chennai",
    "secunderabad": "Hyderabad",
    "hyderabad": "Hyderabad",
    "calcutta": "Kolkata",
    "kolkata": "Kolkata",
    "new delhi": "Delhi",
    "delhi": "Delhi",
    "noida": "Noida",
    "pune": "Pune",
}

# ──────────────────────────────────────────────
# 2.  PREPROCESSING FUNCTIONS
# ──────────────────────────────────────────────

lemmatizer = WordNetLemmatizer()


def clean_location(loc_string: str) -> str:
    """Extract and normalise the primary city from Naukri location strings.

    Examples:
        'Gurgaon/Gurugram'             → 'Gurgaon'
        'Bangalore/Bengaluru, Chennai' → 'Bangalore'
        'Noida(Sector-126 Noida)'      → 'Noida'
    """
    if pd.isna(loc_string):
        return "Unknown"
    # Take the first city before comma / slash
    primary = re.split(r"[,/]", str(loc_string))[0].strip()
    # Remove parenthetical qualifiers like "(Sector-126 Noida)"
    primary = re.sub(r"\(.*?\)", "", primary).strip().title()
    # Map aliases
    key = primary.lower().strip()
    return CITY_ALIASES.get(key, primary)


def parse_experience(exp_string: str) -> float:
    """Convert '4-8 Yrs' → midpoint 6.0;  '1 Yr' → 1.0."""
    if pd.isna(exp_string):
        return np.nan
    nums = re.findall(r"(\d+)", str(exp_string))
    if len(nums) >= 2:
        return (int(nums[0]) + int(nums[1])) / 2
    elif len(nums) == 1:
        return float(nums[0])
    return np.nan


def normalize_job_title(title: str) -> str:
    """Map raw job titles to canonical role buckets."""
    if pd.isna(title):
        return "other"
    t = str(title).lower()

    # Order matters — check specific roles first
    role_keywords = [
        ("machine learning",  "machine learning"),
        ("data scientist",    "data scientist"),
        ("data entry",        "data entry"),
        ("bpo",               "bpo"),
        ("reporting",         "reporting"),
        ("software engineer", "software engineer"),
        ("developer",         "software engineer"),
        ("engineer",          "engineer"),
        ("manager",           "manager"),
        ("analyst",           "analyst"),
        ("data",              "data professional"),
    ]
    for kw, role in role_keywords:
        if kw in t:
            return role
    return "other"


def tokenize_skills(skills_string: str) -> list[str]:
    """Split Naukri's concatenated skill strings into individual tokens.

    The raw data often looks like:
        'Text miningCareer developmentdata scienceFinance'
    Skills are separated by camelCase boundaries or special characters.
    """
    if pd.isna(skills_string):
        return []
    # Insert a separator before uppercase letters that follow lowercase letters
    spaced = re.sub(r"([a-z])([A-Z])", r"\1 | \2", str(skills_string))
    tokens = re.split(r"[|,;/]", spaced)
    return [lemmatizer.lemmatize(t.strip().lower()) for t in tokens if t.strip()]


# ──────────────────────────────────────────────
# 3.  FEATURE EXTRACTION
# ──────────────────────────────────────────────

def count_ai_mentions(skills_lower: str) -> int:
    """Count distinct AI tools mentioned in a lowercase text blob."""
    return sum(1 for tool in AI_TOOLS if tool in skills_lower)


def detect_automation_signal(text_lower: str) -> float:
    """Return automation weight for a single posting.

    Returns 1.0 if automation keywords dominate, 0.5 if augmentation keywords
    dominate, or a blend.  0.0 if neither detected.
    """
    auto_hits = sum(1 for kw in AUTOMATION_KEYWORDS if kw in text_lower)
    aug_hits  = sum(1 for kw in AUGMENTATION_KEYWORDS if kw in text_lower)
    if auto_hits + aug_hits == 0:
        return 0.0
    # Weighted blend: auto=1.0, aug=0.5
    return (auto_hits * 1.0 + aug_hits * 0.5) / (auto_hits + aug_hits)


def count_manual_flags(text_lower: str) -> int:
    """Count manual/repetitive task indicators."""
    return sum(1 for kw in MANUAL_KEYWORDS if kw in text_lower)


# ──────────────────────────────────────────────
# 4.  MAIN PIPELINE
# ──────────────────────────────────────────────

def preprocess(df: pd.DataFrame) -> pd.DataFrame:
    """Clean raw Naukri data and engineer per-posting features."""
    print(f"[preprocess] Starting with {len(df):,} rows")

    # Drop rows missing critical fields
    df = df.dropna(subset=["Job_Titles", "Locations", "Skills"]).copy()
    print(f"[preprocess] After dropna: {len(df):,} rows")

    # --- Normalise columns ---
    df["Primary_City"]     = df["Locations"].apply(clean_location)
    df["Normalized_Role"]  = df["Job_Titles"].apply(normalize_job_title)
    df["Experience_Mid"]   = df["Experience_Required"].apply(parse_experience)

    # --- Skill-level features (work on lowered text once) ---
    skills_lower = df["Skills"].str.lower().fillna("")
    df["AI_Mentions"]       = skills_lower.apply(count_ai_mentions)
    df["Requires_AI"]       = (df["AI_Mentions"] > 0).astype(int)
    df["Automation_Weight"] = skills_lower.apply(detect_automation_signal)
    df["Manual_Flags"]      = skills_lower.apply(count_manual_flags)

    # --- Deduplicate by Post_Url (some postings appear multiple times) ---
    if "Post_Url" in df.columns:
        before = len(df)
        df = df.drop_duplicates(subset=["Post_Url"], keep="first")
        print(f"[preprocess] Deduped: {before:,} → {len(df):,}")

    return df


def compute_l1_index(df: pd.DataFrame, min_jobs: int = 5) -> pd.DataFrame:
    """Aggregate per (city, role) and compute the AI Vulnerability Index.

    Steps:
      1. Group by (Primary_City, Normalized_Role)
      2. Compute observed exposure (AI penetration %) and avg automation weight
      3. Look up theoretical exposure β for the role
      4. Blend into final index via configurable coefficients
    """
    print("[L1] Aggregating market signals …")

    agg = df.groupby(["Primary_City", "Normalized_Role"]).agg(
        Total_Jobs          = ("Job_Titles", "count"),
        Jobs_with_AI        = ("Requires_AI", "sum"),
        Avg_Automation_Wt   = ("Automation_Weight", "mean"),
        Avg_Manual_Flags    = ("Manual_Flags", "mean"),
        Avg_AI_Mentions     = ("AI_Mentions", "mean"),
        Med_Experience      = ("Experience_Mid", "median"),
    ).reset_index()

    # --- Observed exposure = AI penetration rate ---
    agg["AI_Penetration_Pct"] = (agg["Jobs_with_AI"] / agg["Total_Jobs"]) * 100
    agg["Observed_Exposure"]  = agg["AI_Penetration_Pct"] / 100  # 0-1

    # Boost observed exposure by average automation weight
    #   (a city/role with many automation-style postings is riskier)
    agg["Observed_Exposure_Adj"] = (
        agg["Observed_Exposure"] * 0.7 + agg["Avg_Automation_Wt"] * 0.3
    ).clip(0, 1)

    # --- Theoretical exposure β ---
    agg["Theoretical_Exposure"] = agg["Normalized_Role"].map(ROLE_THEORETICAL_BETA).fillna(0.45)

    # --- Role baseline ---
    agg["Role_Baseline"] = agg["Normalized_Role"].map(ROLE_BASELINE).fillna(0.45)

    # --- Composite AI Vulnerability Index ---
    raw_score = (
        COEFF_OBSERVED    * agg["Observed_Exposure_Adj"]
        + COEFF_THEORETICAL * agg["Theoretical_Exposure"]
        + COEFF_BASELINE    * agg["Role_Baseline"]
    )
    agg["AI_Vulnerability_Index"] = (raw_score * 100).round().clip(0, 100).astype(int)

    # --- Filter noise ---
    agg = agg[agg["Total_Jobs"] >= min_jobs].copy()
    agg["Last_Updated"] = datetime.now().strftime("%Y-%m-%d %H:%M")

    print(f"[L1] {len(agg):,} (city, role) combinations with >= {min_jobs} jobs")
    return agg.sort_values("AI_Vulnerability_Index", ascending=False).reset_index(drop=True)


# ──────────────────────────────────────────────
# 5.  CLI ENTRY POINT
# ──────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="AI Vulnerability Pipeline – Layer 1")
    parser.add_argument("--csv", default="Main_Naukri.csv", help="Path to job-postings CSV")
    parser.add_argument("--min-jobs", type=int, default=5, help="Minimum jobs per city/role")
    parser.add_argument("--out", default="l1_vulnerability.csv", help="Output CSV path")
    args = parser.parse_args()

    # Load
    print(f"Loading {args.csv} …")
    df = pd.read_csv(args.csv)

    # Process
    df_clean = preprocess(df)
    l1 = compute_l1_index(df_clean, min_jobs=args.min_jobs)

    # Display top results
    print("\n══════ TOP 10 VULNERABLE (CITY, ROLE) COMBINATIONS ══════")
    display_cols = [
        "Primary_City", "Normalized_Role", "Total_Jobs",
        "AI_Penetration_Pct", "Observed_Exposure_Adj",
        "Theoretical_Exposure", "AI_Vulnerability_Index",
    ]
    print(l1[display_cols].head(10).to_string(index=False))

    # Save
    l1.to_csv(args.out, index=False)
    print(f"\n[L1] Saved to {args.out}")

    return l1


if __name__ == "__main__":
    main()
