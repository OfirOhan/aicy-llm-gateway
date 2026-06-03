"""
prepare_data.py — Dataset preparation for prompt injection classifier.

Merges public HuggingFace datasets with our custom adversarial samples,
then splits into train/test sets for fine-tuning.
"""

import json
from pathlib import Path
import datasets
from datasets import load_dataset, Dataset, DatasetDict, concatenate_datasets


DATA_DIR = Path(__file__).parent / "data"
OUTPUT_DIR = DATA_DIR / "prepared"


def load_custom_samples() -> Dataset:
    """Load our custom multilingual/unicode/creative-writing samples."""
    samples = []
    custom_path = DATA_DIR / "custom_samples.jsonl"

    with open(custom_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                samples.append(json.loads(line))

    return Dataset.from_list(samples)


def load_deepset_dataset() -> Dataset:
    """
    Load the deepset/prompt-injections dataset from HuggingFace.
    Maps columns to our standard format: text, label.
    """
    ds = load_dataset("deepset/prompt-injections", split="train")

    # Ensure consistent column names
    if "text" not in ds.column_names:
        # Some versions use 'prompt' instead of 'text'
        if "prompt" in ds.column_names:
            ds = ds.rename_column("prompt", "text")

    # Keep only text and label columns
    keep_cols = {"text", "label"}
    remove_cols = [c for c in ds.column_names if c not in keep_cols]
    if remove_cols:
        ds = ds.remove_columns(remove_cols)

    return ds


def load_jailbreak_dataset() -> Dataset:
    """
    Load jailbreak classification samples from HuggingFace.
    Maps to binary labels: 1 = injection, 0 = benign.
    """
    try:
        ds = load_dataset("jackhhao/jailbreak-classification", split="train")

        # Map column names
        if "prompt" in ds.column_names and "text" not in ds.column_names:
            ds = ds.rename_column("prompt", "text")

        # Convert labels to binary (anything flagged as jailbreak = 1)
        if "type" in ds.column_names:
            ds = ds.map(
                lambda x: {"label": 1 if x["type"] == "jailbreak" else 0}
            )
            ds = ds.remove_columns(
                [c for c in ds.column_names if c not in {"text", "label"}]
            )

        # Keep only text and label
        keep_cols = {"text", "label"}
        remove_cols = [c for c in ds.column_names if c not in keep_cols]
        if remove_cols:
            ds = ds.remove_columns(remove_cols)

        return ds
    except Exception as e:
        print(f"⚠️  Could not load jailbreak dataset: {e}")
        print("   Continuing without it...")
        return None


def prepare() -> DatasetDict:
    """
    Merge all data sources, deduplicate, shuffle, and split into
    train (85%) and test (15%) sets.
    """
    print("📥 Loading datasets...")

    datasets_to_merge = []

    # 1. Custom samples (always available, local)
    custom = load_custom_samples()
    print(f"   Custom samples: {len(custom)}")
    datasets_to_merge.append(custom)

    # 2. deepset/prompt-injections
    try:
        deepset = load_deepset_dataset()
        print(f"   deepset/prompt-injections: {len(deepset)}")
        datasets_to_merge.append(deepset)
    except Exception as e:
        print(f"⚠️  Could not load deepset dataset: {e}")

    # 3. Jailbreak classification
    jailbreak = load_jailbreak_dataset()
    if jailbreak is not None:
        print(f"   jackhhao/jailbreak-classification: {len(jailbreak)}")
        datasets_to_merge.append(jailbreak)

    # Merge all datasets
    print("\n🔀 Merging datasets...")
    merged = concatenate_datasets(datasets_to_merge)
    print(f"   Total samples before dedup: {len(merged)}")

    # Deduplicate by text content
    seen = set()
    unique_indices = []
    for i, text in enumerate(merged["text"]):
        normalized = text.strip().lower()
        if normalized not in seen:
            seen.add(normalized)
            unique_indices.append(i)

    merged = merged.select(unique_indices)
    print(f"   Total samples after dedup: {len(merged)}")

    # Cast label to ClassLabel (required for stratified split)
    merged = merged.cast_column(
        "label", datasets.ClassLabel(names=["BENIGN", "INJECTION"])
    )

    # Print label distribution
    labels = merged["label"]
    n_injection = sum(labels)
    n_benign = len(labels) - n_injection
    print(f"   Label distribution: {n_benign} benign, {n_injection} injection")

    # Shuffle and split: 70% train, 15% val, 15% test
    print("\n✂️  Splitting into train/val/test (70/15/15)...")

    # First split: 70% train, 30% temp
    train_temp = merged.train_test_split(
        test_size=0.30, seed=42, stratify_by_column="label"
    )

    # Second split: split the 30% temp into 15% val + 15% test
    val_test = train_temp["test"].train_test_split(
        test_size=0.50, seed=42, stratify_by_column="label"
    )

    split = DatasetDict({
        "train": train_temp["train"],
        "val": val_test["train"],
        "test": val_test["test"],
    })

    print(f"   Train: {len(split['train'])}")
    print(f"   Val:   {len(split['val'])}")
    print(f"   Test:  {len(split['test'])}")

    # Save to disk
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    split.save_to_disk(str(OUTPUT_DIR))
    print(f"\n💾 Saved prepared dataset to {OUTPUT_DIR}")

    return split


if __name__ == "__main__":
    prepare()
