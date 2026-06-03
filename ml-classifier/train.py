"""
train.py — Fine-tune Meta Prompt Guard 2 (22M) for prompt injection detection.

Loads the prepared dataset, fine-tunes the pre-trained model for 3 epochs,
and saves the final model + tokenizer to the model/ directory.
"""

import torch
from pathlib import Path
from datasets import load_from_disk
from transformers import (
    AutoTokenizer,
    AutoModelForSequenceClassification,
    TrainingArguments,
    Trainer,
)
from sklearn.metrics import accuracy_score, precision_recall_fscore_support


# ── Configuration ────────────────────────────────────────────────────────────

MODEL_NAME = "protectai/deberta-v3-base-prompt-injection-v2"
DATA_DIR = Path(__file__).parent / "data" / "prepared"
OUTPUT_DIR = Path(__file__).parent / "model"
MAX_LENGTH = 256
BATCH_SIZE = 4
GRAD_ACCUM_STEPS = 4  # Effective batch size = 4 × 4 = 16
EPOCHS = 3
LEARNING_RATE = 2e-5


def compute_metrics(eval_pred):
    """Compute accuracy, precision, recall, and F1 for the trainer."""
    logits, labels = eval_pred
    predictions = logits.argmax(axis=-1)
    precision, recall, f1, _ = precision_recall_fscore_support(
        labels, predictions, average="binary", pos_label=1
    )
    acc = accuracy_score(labels, predictions)
    return {
        "accuracy": acc,
        "precision": precision,
        "recall": recall,
        "f1": f1,
    }


def main():
    # ── Detect device ────────────────────────────────────────────────────────
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"🖥️  Using device: {device}")
    if device == "cuda":
        print(f"   GPU: {torch.cuda.get_device_name(0)}")
        print(f"   VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")

    # ── Load prepared dataset ────────────────────────────────────────────────
    print("\n📥 Loading prepared dataset...")
    dataset = load_from_disk(str(DATA_DIR))
    print(f"   Train: {len(dataset['train'])} samples")
    print(f"   Val:   {len(dataset['val'])} samples")
    print(f"   Test:  {len(dataset['test'])} samples (held out for final eval)")

    # ── Load tokenizer and model ─────────────────────────────────────────────
    print(f"\n🤖 Loading model: {MODEL_NAME}")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModelForSequenceClassification.from_pretrained(
        MODEL_NAME,
        num_labels=2,
        ignore_mismatched_sizes=True,
    )

    # ── Freeze layers ────────────────────────────────────────────────────────
    # The model already knows prompt injection detection. We only fine-tune
    # the top 3 encoder layers + classification head to learn our new patterns
    # (multilingual, unicode, creative writing) without forgetting existing knowledge.

    # Freeze embeddings
    for param in model.deberta.embeddings.parameters():
        param.requires_grad = False

    # Freeze bottom 9 of 12 encoder layers (only top 3 are trainable)
    num_layers = len(model.deberta.encoder.layer)
    freeze_up_to = num_layers - 3  # Freeze layers 0-8, train layers 9-11
    for i, layer in enumerate(model.deberta.encoder.layer):
        if i < freeze_up_to:
            for param in layer.parameters():
                param.requires_grad = False

    # Count trainable vs frozen params
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    print(f"   Trainable params: {trainable:,} / {total:,} ({100*trainable/total:.1f}%)")

    # Update label mapping
    model.config.id2label = {0: "BENIGN", 1: "INJECTION"}
    model.config.label2id = {"BENIGN": 0, "INJECTION": 1}

    # ── Tokenize dataset ─────────────────────────────────────────────────────
    print("\n🔤 Tokenizing dataset...")

    def tokenize(batch):
        return tokenizer(
            batch["text"],
            truncation=True,
            padding="max_length",
            max_length=MAX_LENGTH,
        )

    tokenized = dataset.map(tokenize, batched=True, remove_columns=["text"])
    tokenized.set_format("torch")

    # ── Training arguments ───────────────────────────────────────────────────
    training_args = TrainingArguments(
        output_dir=str(OUTPUT_DIR / "checkpoints"),
        num_train_epochs=EPOCHS,
        per_device_train_batch_size=BATCH_SIZE,
        per_device_eval_batch_size=BATCH_SIZE,
        gradient_accumulation_steps=GRAD_ACCUM_STEPS,
        learning_rate=LEARNING_RATE,
        weight_decay=0.01,
        fp16=torch.cuda.is_available(),  # Half precision to save VRAM
        eval_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model="f1",
        greater_is_better=True,
        logging_steps=10,
        seed=42,
        report_to="none",  # Disable wandb/tensorboard
    )

    # ── Train ────────────────────────────────────────────────────────────────
    print("\n🚀 Starting training...")
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized["train"],
        eval_dataset=tokenized["val"],
        compute_metrics=compute_metrics,
    )

    trainer.train()

    # ── Save final model ─────────────────────────────────────────────────────
    print(f"\n💾 Saving fine-tuned model to {OUTPUT_DIR}")
    trainer.save_model(str(OUTPUT_DIR))
    tokenizer.save_pretrained(str(OUTPUT_DIR))

    # ── Final evaluation ─────────────────────────────────────────────────────
    print("\n📊 Final evaluation on test set:")
    metrics = trainer.evaluate()
    for key, value in metrics.items():
        if key.startswith("eval_"):
            print(f"   {key}: {value:.4f}")

    print("\n✅ Training complete!")


if __name__ == "__main__":
    main()
