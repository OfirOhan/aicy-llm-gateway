"""
app.py — FastAPI microservice for prompt injection classification.

Loads a fine-tuned Prompt Guard 2 model and exposes:
  POST /classify  — Classify a text as BENIGN or INJECTION
  GET  /health    — Health check endpoint
"""

import torch
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from transformers import AutoTokenizer, AutoModelForSequenceClassification


# ── Configuration ────────────────────────────────────────────────────────────

MODEL_DIR = Path(__file__).parent / "model"
MAX_LENGTH = 256

# Global model references (loaded once at startup)
tokenizer = None
model = None


# ── Lifespan (startup / shutdown) ────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load the model on startup, release on shutdown."""
    global tokenizer, model

    print(f"🤖 Loading model from {MODEL_DIR}...")

    if not MODEL_DIR.exists():
        print(
            "⚠️  No fine-tuned model found. "
            "Run train.py first, or the service will use the base model."
        )
        # Fall back to base model for development
        model_path = "protectai/deberta-v3-base-prompt-injection-v2"
    else:
        # Verify model files aren't Git LFS pointers (< 1 KB = pointer file)
        weights_file = MODEL_DIR / "model.safetensors"
        if weights_file.exists() and weights_file.stat().st_size < 1024:
            raise RuntimeError(
                "❌ model.safetensors appears to be a Git LFS pointer file, "
                "not the actual model weights. Please run:\n"
                "   git lfs install && git lfs pull\n"
                "Then restart the service."
            )
        model_path = str(MODEL_DIR)

    tokenizer = AutoTokenizer.from_pretrained(model_path)
    model = AutoModelForSequenceClassification.from_pretrained(model_path)
    model.eval()

    print("✅ Model loaded successfully!")
    yield

    # Cleanup
    del model, tokenizer
    print("🔌 Model unloaded.")


# ── FastAPI app ──────────────────────────────────────────────────────────────

app = FastAPI(
    title="SecureLLM Prompt Injection Classifier",
    version="1.0.0",
    lifespan=lifespan,
)


# ── Request / Response schemas ───────────────────────────────────────────────

class ClassifyRequest(BaseModel):
    text: str


class ClassifyResponse(BaseModel):
    is_injection: bool
    confidence: float
    label: str


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool


# ── Endpoints ────────────────────────────────────────────────────────────────

@app.post("/classify", response_model=ClassifyResponse)
async def classify(request: ClassifyRequest):
    """Classify a text prompt as BENIGN or INJECTION."""
    if model is None or tokenizer is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    inputs = tokenizer(
        request.text,
        return_tensors="pt",
        truncation=True,
        padding="max_length",
        max_length=MAX_LENGTH,
    )

    with torch.no_grad():
        outputs = model(**inputs)
        probs = torch.softmax(outputs.logits, dim=-1)
        predicted_class = probs.argmax(dim=-1).item()
        confidence = probs[0][predicted_class].item()

    is_injection = predicted_class == 1
    label = "INJECTION" if is_injection else "BENIGN"

    return ClassifyResponse(
        is_injection=is_injection,
        confidence=round(confidence, 4),
        label=label,
    )


@app.get("/health", response_model=HealthResponse)
async def health():
    """Health check endpoint for Docker healthcheck."""
    return HealthResponse(
        status="ok",
        model_loaded=model is not None and tokenizer is not None,
    )
