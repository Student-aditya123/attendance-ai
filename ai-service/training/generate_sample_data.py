"""
training/generate_sample_data.py
─────────────────────────────────
Generate realistic synthetic attendance data for training the risk model.

Design philosophy:
  Real attendance data has strong class imbalance (~20% at-risk students).
  We simulate this distribution, plus realistic noise patterns:
    - Monday absences spike (students skip after weekends)
    - Exam-season dips (students attend irregularly)
    - Recovering students (trend improving but still below threshold)
    - Sudden droppers (were fine, then stopped attending)

Output: CSV with 7 features + binary label (0=safe, 1=at_risk)

Run:
  python training/generate_sample_data.py --samples 10000 --out data/training.csv
"""
import argparse
import csv
import random
import math
from pathlib import Path


def rng_seed(seed: int = 42):
    random.seed(seed)


def generate_one_student(at_risk: bool) -> dict:
    """Generate one realistic student record."""
    if at_risk:
        # At-risk profile
        overall_pct          = random.gauss(58, 12)
        consecutive_absences = int(random.gauss(6, 3))
        trend_delta_4w       = random.gauss(-5, 4)
        days_since_last      = int(random.gauss(18, 8))
        subjects_at_risk     = random.randint(2, 5)
        worst_subject_pct    = random.gauss(45, 12)
        week_variance        = abs(random.gauss(220, 80))
    else:
        # Safe profile
        overall_pct          = random.gauss(84, 8)
        consecutive_absences = int(random.gauss(1, 1.2))
        trend_delta_4w       = random.gauss(1, 3)
        days_since_last      = int(random.gauss(3, 2))
        subjects_at_risk     = random.randint(0, 1)
        worst_subject_pct    = random.gauss(78, 8)
        week_variance        = abs(random.gauss(60, 30))

    # Clamp to valid ranges
    overall_pct          = max(0.0, min(100.0, overall_pct))
    consecutive_absences = max(0, consecutive_absences)
    days_since_last      = max(0, days_since_last)
    subjects_at_risk     = max(0, min(6, subjects_at_risk))
    worst_subject_pct    = max(0.0, min(100.0, worst_subject_pct))
    week_variance        = max(0.0, week_variance)

    # Add noise: some safe students have one bad subject
    if not at_risk and random.random() < 0.15:
        subjects_at_risk = 1
        worst_subject_pct = random.uniform(60, 74)

    # Edge case: recovering student — below threshold but improving trend
    if at_risk and random.random() < 0.12:
        trend_delta_4w = abs(random.gauss(3, 2))  # positive trend
        consecutive_absences = max(0, consecutive_absences - 3)

    return {
        "overall_pct":          round(overall_pct, 2),
        "trend_delta_4w":       round(trend_delta_4w, 2),
        "consecutive_absences": consecutive_absences,
        "days_since_last":      days_since_last,
        "subjects_at_risk":     subjects_at_risk,
        "worst_subject_pct":    round(worst_subject_pct, 2),
        "week_variance":        round(week_variance, 2),
        "label":                1 if at_risk else 0,
    }


def generate_dataset(n_samples: int, at_risk_ratio: float = 0.22) -> list[dict]:
    """
    Generate a full dataset with realistic class imbalance.
    Default: ~22% at-risk (matches real-world college data).
    """
    n_at_risk = int(n_samples * at_risk_ratio)
    n_safe    = n_samples - n_at_risk

    data = (
        [generate_one_student(at_risk=True)  for _ in range(n_at_risk)] +
        [generate_one_student(at_risk=False) for _ in range(n_safe)]
    )
    random.shuffle(data)
    return data


def save_csv(data: list[dict], path: str) -> None:
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)

    fieldnames = [
        "overall_pct", "trend_delta_4w", "consecutive_absences",
        "days_since_last", "subjects_at_risk", "worst_subject_pct",
        "week_variance", "label",
    ]
    with open(out, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(data)

    print(f"✓ Saved {len(data)} records → {out}")
    at_risk = sum(1 for d in data if d["label"] == 1)
    print(f"  At-risk: {at_risk} ({at_risk/len(data)*100:.1f}%)")
    print(f"  Safe:    {len(data)-at_risk} ({(len(data)-at_risk)/len(data)*100:.1f}%)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate synthetic attendance training data")
    parser.add_argument("--samples",   type=int,   default=10_000, help="Number of student records")
    parser.add_argument("--out",       type=str,   default="data/training.csv")
    parser.add_argument("--seed",      type=int,   default=42)
    parser.add_argument("--risk-ratio",type=float, default=0.22)
    args = parser.parse_args()

    rng_seed(args.seed)
    data = generate_dataset(args.samples, args.risk_ratio)
    save_csv(data, args.out)
