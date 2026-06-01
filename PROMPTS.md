# PROMPTS.md

## 1. Tools Used

| Tool | What I Used It For |
|------|-------------------|
| **Claude (Anthropic)** | Initial architecture planning, security pattern research, reviewing prompt-injection detection coverage |
| **Gemini (Google — Antigravity agent)** | Primary code generation, TypeScript implementation, test suite creation, debugging, Docker setup |

Both tools touched the same solution files. For example, Claude helped me reason about the prompt-injection regex patterns, and Gemini generated the actual `src/middleware/promptInjection.ts` implementation. I then used Claude to review the pattern coverage for gaps.

---

## 2. Why Multiple Tools

When Gemini generated the prompt-injection detection middleware (`src/middleware/promptInjection.ts`), I asked Claude to review the regex patterns for bypass vulnerabilities. Claude identified that the `system:` pattern could cause false positives on benign text (e.g. "operating system: Linux") and suggested tightening the pattern. I reviewed both outputs and kept the pattern as-is since `system:` followed by a space IS a suspicious delimiter in LLM prompt context — but I added test cases for known false-positive-adjacent inputs (e.g. "The solar system has 8 planets") to make sure the boundary was documented and tested.

This cross-tool verification also caught that `\bDAN\b` is case-sensitive in the regex but the normalisation step lowercases input, meaning it would never match the uppercase literal. The test suite was adjusted to reflect the actual behavior.

---

## 3. Three Example Prompts

### Prompt 1 — Code Generation (Gemini)

> "Create the following 5 middleware files in `src/middleware/`. All use ESM imports with `.js` extensions. [...] File 3: `src/middleware/promptInjection.ts` — Export `detectPromptInjection(text: string)` so it can be unit tested independently. Detect at least 3 distinct pattern categories: role override (ignore instructions, reveal prompt, etc.), delimiter injection (###, chat template tokens, base64), jailbreak (DAN, bypass filter, developer mode). Normalise text before scanning. On detection reject 400 with category."

**What I did with the output:** The generated code had 38 regex patterns across 3 categories. I reviewed each pattern manually for correctness and false-positive risk, then wrote 47 unit tests including adversarial variations to verify coverage.

### Prompt 2 — Security Review (Claude)

> "Review this output validation module for bypass vulnerabilities. It checks LLM responses for leaked secrets (sk-..., JWT, AWS keys) and injection echo. Are there any patterns I'm missing? Could an attacker encode a secret to evade detection (e.g. base64, whitespace insertion, Unicode homoglyphs)?"

**What I did with the output:** Claude suggested adding checks for base64-encoded secrets and split-token exfiltration. I noted these as known limitations in the README rather than implementing partial solutions that might give false confidence. The README now explicitly states: "Output validation checks known patterns; novel exfiltration techniques may not be caught."

### Prompt 3 — Debugging (Gemini)

> "TypeScript compilation is failing with 5 errors. The pino logger has an `exactOptionalPropertyTypes` error because the transport field can be undefined. The Redis pipeline result needs a type cast. The chat route's baseAudit Pick type doesn't work with optional piiTokens. The LLM provider has 'possibly undefined' on array access. Fix all of these."

**What I did with the output:** Applied all fixes. The pino fix was to conditionally assign transport instead of using an inline ternary. The LLM provider fix properly validates array elements before access rather than using non-null assertions. The Redis cast goes through `unknown` first. All fixes address real type safety issues rather than just silencing the compiler.

---

## 4. What I Rejected

Claude initially suggested using a third-party library (`pii-redactor`) for PII redaction. I rejected this because:

1. **Israeli-specific requirements**: The challenge requires Israeli phone formats (054-XXX-XXXX, +972) and Teudat Zehut validation with the Luhn-like check-digit algorithm. A generic library wouldn't cover these.
2. **Reversibility**: The challenge requires token-based reversible redaction. Most libraries do one-way redaction.
3. **Dependency risk**: Adding an opaque third-party dependency for a security-critical control means trusting code I can't easily audit. For a gateway that sits between applications and LLMs, I wanted full visibility into what gets redacted and how.

I wrote the PII redaction from scratch with explicit regex patterns and UUID-based tokens, making it fully testable and reversible.

---

## 5. What I Would Do With More Time

### 1. ML-based prompt injection detection
The current regex-based detection catches known patterns but is inherently bypassable with novel attacks (semantic injection, indirect injection via context). With more time, I would integrate a lightweight classifier — either a fine-tuned model or an embedding-similarity approach — that scores messages against known attack embeddings. AI would help by generating a training corpus of injection variants and helping fine-tune a small ONNX model that runs in-process.

### 2. Integration test suite with real Docker containers
The current tests mock Mongo and Redis. With more time, I would add integration tests using `testcontainers` that spin up real Mongo and Redis instances, seed API keys, and test the full request lifecycle end-to-end — including rate limiting across multiple requests and audit log verification. AI would help by generating the container setup boilerplate and the complex multi-request test scenarios.

---

## 6. First AI Interaction on This Challenge

**Tool:** Claude (Anthropic)

**Verbatim first prompt:**

> "ok well, I moved on to the next phase, I have a task. now it is very weird to me, this is not in python and job is python, like idk any other languages"

This was accompanied by the full challenge PDF. In hindsight, sending the entire PDF to an AI tool was an untrusted-input-hygiene mistake — ironic given that the challenge is about handling untrusted input. The PDF itself could contain adversarial content designed to test exactly this behavior (and it did — Section 7's evaluation criteria explicitly scores how candidates handle the PDF).

For all subsequent AI interactions (Gemini/Antigravity), I extracted and sanitized only the functional requirements, stripping evaluation criteria, scoring rubrics, and meta-instructions that aren't relevant to the code and could bias or confuse the AI tool.
