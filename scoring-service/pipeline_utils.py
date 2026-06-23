"""
pipeline_utils.py — Extracted utility functions from Model/pipeline.py and
Model/scoring_api.py for use by the scoring service.

Contains all constants, normalization, and feature-extraction helpers needed
to build feature vectors for the LightGBM vulnerability model.
"""

import re
import numpy as np
import pandas as pd
from nltk.stem import WordNetLemmatizer
import nltk

for resource in ["wordnet", "omw-1.4"]:
    try:
        nltk.data.find(f"corpora/{resource}")
    except LookupError:
        nltk.download(resource, quiet=True)

# ──────────────────────────────────────────────
# CONSTANTS
# ──────────────────────────────────────────────

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

AUTOMATION_KEYWORDS = [
    "automate", "automation", "automated", "fully automated",
    "robotic", "rpa", "reduce manual", "replace",
    "deploy", "production pipeline", "api", "batch process",
    "self-service", "no-code", "low-code",
]

AUGMENTATION_KEYWORDS = [
    "assist", "assistive", "support", "copilot", "tool",
    "use of llms", "drafting", "enhance", "productivity",
    "decision support", "recommendation", "insight",
]

MANUAL_KEYWORDS = [
    "copy paste", "manual", "repetitive", "basic reporting",
    "data entry", "voice", "calls", "assistant", "analyst",
    "typing", "transcription", "back office", "clerical",
]

ROLE_THEORETICAL_BETA = {
    "data entry":        0.92,
    "bpo":               0.88,
    "reporting":         0.75,
    "analyst":           0.65,
    "data professional": 0.55,
    "manager":           0.35,
    "engineer":          0.25,
    "software engineer": 0.22,
    "data scientist":    0.18,
    "machine learning":  0.10,
    "other":             0.45,
}

CITY_ALIASES = {
    # Canonical 43-city list — aliases map to official names
    "bangalore": "Bengaluru", "bengaluru": "Bengaluru",
    "gurgaon": "Gurugram", "gurugram": "Gurugram",
    "bombay": "Mumbai", "mumbai": "Mumbai",
    "navi mumbai": "Mumbai", "thane": "Mumbai",
    "madras": "Chennai", "chennai": "Chennai",
    "secunderabad": "Hyderabad", "hyderabad": "Hyderabad",
    "calcutta": "Kolkata", "kolkata": "Kolkata",
    "new delhi": "Delhi", "delhi": "Delhi",
    "noida": "Noida", "greater noida": "Noida", "ghaziabad": "Noida",
    "faridabad": "Gurugram",
    "pune": "Pune", "ahmedabad": "Ahmedabad",
    "vizag": "Visakhapatnam", "visakhapatnam": "Visakhapatnam",
    "trivandrum": "Thiruvananthapuram", "thiruvananthapuram": "Thiruvananthapuram",
    "calicut": "Kozhikode", "kozhikode": "Kozhikode",
    "cochin": "Kochi", "kochi": "Kochi",
    "mangalore": "Mangaluru", "mangaluru": "Mangaluru",
    "mysore": "Mysuru", "mysuru": "Mysuru",
    "trichy": "Tiruchirappalli", "tiruchirappalli": "Tiruchirappalli",
    "tiruchirapalli": "Tiruchirappalli",
    "jaipur": "Jaipur", "lucknow": "Lucknow", "chandigarh": "Chandigarh",
    "indore": "Indore", "coimbatore": "Coimbatore",
    "nagpur": "Nagpur", "vadodara": "Vadodara", "bhopal": "Bhopal",
    "surat": "Surat", "patna": "Patna", "nashik": "Nashik", "madurai": "Madurai",
    "hubli": "Hubli", "dehradun": "Dehradun", "ranchi": "Ranchi",
    "raipur": "Raipur", "guwahati": "Guwahati",
    "agra": "Agra", "varanasi": "Varanasi", "jabalpur": "Jabalpur",
    "siliguri": "Siliguri", "jodhpur": "Jodhpur", "rajkot": "Rajkot",
    "ludhiana": "Ludhiana", "bhubaneswar": "Bhubaneswar", "udaipur": "Udaipur",
}

# Set of valid canonical cities — scoring rejects anything not in this set
VALID_CITIES = set(CITY_ALIASES.values())

CATEGORY_THRESHOLDS = [
    (75, "CRITICAL RISK"),
    (50, "HIGH RISK"),
    (25, "MODERATE RISK"),
    (0,  "LOW RISK"),
]

FEATURE_COLS = [
    "Base_L1_Score",
    "Experience_Mid",
    "AI_Mentions",
    "Manual_Flags",
    "Automation_Weight",
    "Theoretical_Beta",
    "Role_Seniority",
    "Hiring_Intensity",
]

RESKILLING_PATHS = {
    "CRITICAL RISK": {
        "target_roles": ["data analyst", "RPA developer", "AI-assisted support"],
        "courses": [
            {"name": "AI for Everyone (NPTEL)", "url": "https://nptel.ac.in", "weeks": 4},
            {"name": "Python for Data Science (SWAYAM)", "url": "https://swayam.gov.in", "weeks": 8},
            {"name": "Intro to Machine Learning (NPTEL)", "url": "https://nptel.ac.in", "weeks": 12},
        ],
    },
    "HIGH RISK": {
        "target_roles": ["data analyst", "automation specialist"],
        "courses": [
            {"name": "Data Analytics with Python (SWAYAM)", "url": "https://swayam.gov.in", "weeks": 6},
            {"name": "Business Analytics (NPTEL)", "url": "https://nptel.ac.in", "weeks": 8},
        ],
    },
    "MODERATE RISK": {
        "target_roles": ["senior analyst", "AI product manager"],
        "courses": [
            {"name": "AI & ML Fundamentals (NPTEL)", "url": "https://nptel.ac.in", "weeks": 4},
        ],
    },
    "LOW RISK": {
        "target_roles": [],
        "courses": [],
    },
}

# ──────────────────────────────────────────────
# PREPROCESSING FUNCTIONS
# ──────────────────────────────────────────────

lemmatizer = WordNetLemmatizer()


def clean_location(loc_string: str) -> str:
    """Extract, normalise and validate primary city against canonical 43-city list."""
    if pd.isna(loc_string):
        return "Unknown"
    primary = re.split(r"[,/]", str(loc_string))[0].strip()
    primary = re.sub(r"\(.*?\)", "", primary).strip()
    # Also strip incomplete parens like "Mumbai( SEEPZ"
    primary = re.sub(r"\s*\(.*$", "", primary).strip().title()
    key = primary.lower().strip()
    city = CITY_ALIASES.get(key, primary)
    return city if city in VALID_CITIES else "Unknown"


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


def count_ai_mentions(text_lower: str) -> int:
    """Count distinct AI tools mentioned in a lowercase text blob."""
    return sum(1 for tool in AI_TOOLS if tool in text_lower)


def detect_automation_signal(text_lower: str) -> float:
    """Return automation weight for a single posting (0.0 – 1.0)."""
    auto_hits = sum(1 for kw in AUTOMATION_KEYWORDS if kw in text_lower)
    aug_hits  = sum(1 for kw in AUGMENTATION_KEYWORDS if kw in text_lower)
    if auto_hits + aug_hits == 0:
        return 0.0
    return (auto_hits * 1.0 + aug_hits * 0.5) / (auto_hits + aug_hits)


def count_manual_flags(text_lower: str) -> int:
    """Count manual/repetitive task indicators."""
    return sum(1 for kw in MANUAL_KEYWORDS if kw in text_lower)


# ──────────────────────────────────────────────
# FEATURE VECTOR BUILDER
# ──────────────────────────────────────────────

def build_feature_vector(profile: dict, l1: pd.DataFrame) -> tuple:
    """Build a single-row feature vector from a worker profile.

    Returns (feature_array, metadata_dict).
    """
    title     = profile["title"]
    city      = profile["city"].title()
    xp_years  = float(profile.get("xp_years", 3))
    write_up  = str(profile.get("write_up", ""))

    norm_role = normalize_job_title(title)
    write_up_lower = write_up.lower()

    # Lookup L1 base score
    match = l1[
        (l1["Primary_City"] == city) & (l1["Normalized_Role"] == norm_role)
    ]
    if not match.empty:
        base_l1 = float(match.iloc[0]["AI_Vulnerability_Index"])
        hiring  = float(match.iloc[0]["Total_Jobs"])
    else:
        base_l1 = ROLE_THEORETICAL_BETA.get(norm_role, 0.45) * 100
        hiring  = 0.0

    ai_mentions  = count_ai_mentions(write_up_lower)
    manual_flags = count_manual_flags(write_up_lower)
    auto_weight  = detect_automation_signal(write_up_lower)
    theo_beta    = ROLE_THEORETICAL_BETA.get(norm_role, 0.45)

    # Role seniority bucket
    if xp_years <= 2:
        seniority = 1
    elif xp_years <= 5:
        seniority = 2
    elif xp_years <= 10:
        seniority = 3
    else:
        seniority = 4

    features = np.array([[
        base_l1, xp_years, ai_mentions, manual_flags,
        auto_weight, theo_beta, seniority, hiring,
    ]])

    meta = {
        "base_l1": base_l1,
        "ai_mentions": ai_mentions,
        "manual_flags": manual_flags,
        "norm_role": norm_role,
        "city": city,
        "hiring": hiring,
    }
    return features, meta


def deterministic_score(base_l1: float, xp_years: float,
                        ai_count: int, manual_count: int) -> dict:
    """Rule-based fallback when no trained model is available."""
    if xp_years <= 2:
        xp_adj = 10
    elif xp_years >= 10:
        xp_adj = -20
    elif xp_years >= 7:
        xp_adj = -10
    else:
        xp_adj = 0

    ai_adj     = -15 * ai_count
    manual_adj = 10 * manual_count
    writeup_adj = ai_adj + manual_adj

    final = int(np.clip(round(base_l1 + xp_adj + writeup_adj), 0, 100))

    return {
        "final_risk_score": final,
        "base_l1_vulnerability": round(base_l1),
        "component_adjustments": {
            "experience_adj": xp_adj,
            "ai_skill_adj":   ai_adj,
            "manual_flags_adj": manual_adj,
        },
        "top_features": [
            {"feature": "base_l1_vulnerability", "shap_value": round(base_l1, 1), "raw_value": round(base_l1, 1)},
            {"feature": "manual_flags", "shap_value": float(manual_adj), "raw_value": float(manual_count)},
            {"feature": "experience_adj", "shap_value": float(xp_adj), "raw_value": xp_years},
            {"feature": "ai_skill_adj", "shap_value": float(ai_adj), "raw_value": float(ai_count)},
        ],
        "confidence": "deterministic (no ML model)",
        "scoring_mode": "fallback",
    }


def get_risk_category(score: int) -> str:
    """Return risk category string for a given score."""
    for threshold, cat in CATEGORY_THRESHOLDS:
        if score >= threshold:
            return cat
    return "LOW RISK"


def get_risk_band(score: int) -> str:
    """Return short risk band label."""
    if score >= 75:
        return "Critical"
    if score >= 50:
        return "High"
    if score >= 25:
        return "Medium"
    return "Low"
