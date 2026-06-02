# PROMPTS.md

## 1. Tools Used

| Tool | What I Used It For |
|------|-------------------|
| **Gemini (Google)** | Initial task understanding — I sent the challenge PDF to Gemini for reasoning about the requirements since the role is Python-oriented and I wanted to confirm this TypeScript/Node.js task was correct |
| **Antigravity (Claude-powered agent)** | All code generation, implementation, testing, Docker setup, debugging |

---

## 2. Why Multiple Tools

I used Gemini first to understand and reason about the challenge requirements, then Antigravity (a Claude-powered coding agent) to build the entire implementation. Both tools processed the same challenge requirements — Gemini received the full PDF for analysis, while Antigravity received a sanitized version with only the functional requirements extracted.

<!-- TODO: Add a specific moment where a second tool verified/challenged the first tool's output on the same solution file -->

---

## 3. Three Example Prompts

### Prompt 1 — Code Generation (Antigravity / Claude)

> "this is the mission, lets begin with the components and all"

This was sent alongside the extracted functional requirements from the challenge. Antigravity generated a full implementation plan, then after my approval built the entire project — 17 source files across middleware, services, routes, and utilities. I reviewed the plan before approving execution.

### Prompt 2 — Security Review

<!-- TODO: Add a verbatim security review prompt and what you did with the output -->

### Prompt 3 — Debugging

<!-- TODO: Add a verbatim debugging prompt and what you did with the output -->

---

## 4. What I Rejected

<!-- TODO: Add one example of AI output you rejected or rewrote, and why -->

---

## 5. What I Would Do With More Time

### 1. ML-based prompt injection detection
The current regex-based detection catches known patterns but is inherently bypassable with novel attacks (semantic injection, indirect injection via context). With more time, I would integrate a lightweight classifier — either a fine-tuned model or an embedding-similarity approach — that scores messages against known attack embeddings. AI would help by generating a training corpus of injection variants and helping fine-tune a small model.

### 2. Integration test suite with real Docker containers
The current tests mock Mongo and Redis. With more time, I would add integration tests using `testcontainers` that spin up real Mongo and Redis instances, seed API keys, and test the full request lifecycle end-to-end — including rate limiting across multiple requests and audit log verification. AI would help by generating the container setup boilerplate and complex multi-request test scenarios.

---

## 6. First AI Interaction on This Challenge

**Tool:** Gemini (Google)

**Verbatim first prompt:**

> "ok well, I moved on to the next phase, I have a task. now it is very weird to me, this is not in python and job is python, like idk any other languages"

This was sent along with the full challenge PDF. I sent the PDF to Gemini because I wanted to understand whether this task was correct — the role I applied for is Python-oriented, and receiving a TypeScript challenge was unexpected. I wanted Gemini's reasoning to help me understand the requirements before starting.

Sending the full PDF was a mistake that I realized shortly after. For my next tool (Antigravity/Claude), I extracted and sent only the functional requirements, removing evaluation criteria and scoring rubrics that aren't relevant to the implementation.
