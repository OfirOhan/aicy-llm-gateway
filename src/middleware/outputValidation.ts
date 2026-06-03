import { logger } from '../utils/logger.js';

// ─── Validation Result ──────────────────────────────────────────────────────

interface OutputValidationResult {
  safe: boolean;
  reason: string | null;
}

// ─── Refusal Indicators ─────────────────────────────────────────────────────

/**
 * If the LLM is correctly refusing an injection attempt, these phrases
 * indicate a legitimate refusal rather than a successful injection echo.
 * Used to avoid false positives in the echo check below.
 */
const REFUSAL_INDICATORS: RegExp[] = [
  /\bi (cannot|can't|won't|will not|am unable to|refuse to)\b/i,
  /\bi'm (unable|not able|not going to)\b/i,
  /\bi must (decline|refuse)\b/i,
  /\bthat('s| is) (not something i (can|will)|against my)\b/i,
];

// ─── Secret Leak Patterns ───────────────────────────────────────────────────

/**
 * Patterns that match well-known API key and credential formats.
 * Each entry has a human-readable label and a detection regex.
 */
const SECRET_PATTERNS: { label: string; pattern: RegExp }[] = [
  {
    label: 'Leaked OpenAI API key detected',
    pattern: /sk-proj-[A-Za-z0-9]{20,}/,
  },
  {
    label: 'Leaked OpenAI API key detected',
    pattern: /sk-[A-Za-z0-9]{20,}/,
  },
  {
    label: 'Leaked Anthropic API key detected',
    pattern: /sk-ant-[A-Za-z0-9]{20,}/,
  },
  {
    label: 'Leaked JWT token detected',
    pattern: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  },
  {
    label: 'Leaked AWS access key detected',
    pattern: /AKIA[0-9A-Z]{16}/,
  },
  {
    label: 'Leaked AWS secret key detected',
    // Broadened from label-dependent pattern to match the secret format directly.
    // AWS secret keys are always 40 chars, base64 charset.
    // Tradeoff: may produce false positives on other long base64 strings (e.g. hashes).
    pattern: /[A-Za-z0-9/+=]{40}/,
  },
  {
    label: 'Leaked private key detected',
    pattern: /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/,
  },
];

// ─── Injection Echo Patterns ────────────────────────────────────────────────

/**
 * If the incoming request already had detected threats, these patterns
 * check whether the LLM output is echoing back injected content —
 * a sign that the injection may have partially succeeded.
 */
const INJECTION_ECHO_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+|your\s+|previous\s+|prior\s+)?instructions/i,
  /system\s+prompt/i,
  /reveal\s+(your\s+|the\s+)?(system\s+|initial\s+)?prompt/i,
  /override\s+(your\s+|all\s+|previous\s+)?instructions/i,
  /you\s+are\s+now/i,
  /jailbreak/i,
  /\bDAN\b/,
  /developer\s+mode/i,
  /god\s+mode/i,
  /sudo\s+mode/i,
];

// ─── Helper ─────────────────────────────────────────────────────────────────

function isRefusal(content: string): boolean {
  return REFUSAL_INDICATORS.some((pattern) => pattern.test(content));
}

// ─── Public Validation Function ─────────────────────────────────────────────

/**
 * Validate LLM output content for safety.
 *
 * Checks for:
 *   1. Leaked secret credentials (API keys, JWTs, private keys, etc.)
 *   2. Injection echo — the model repeating back injected prompts when
 *      the request had already-detected threats. Skipped when the LLM
 *      is clearly refusing the injection attempt (to avoid false positives).
 *
 * @param content         The raw LLM response text.
 * @param detectedThreats Optional list of threats detected during request
 *                        processing (populated by promptInjectionMiddleware).
 * @returns               `{ safe: true, reason: null }` when clean,
 *                        `{ safe: false, reason: '...' }` on detection.
 */
export function validateOutput(
  content: string,
  detectedThreats?: string[],
): OutputValidationResult {
  // 1. Check for leaked secrets
  for (const { label, pattern } of SECRET_PATTERNS) {
    if (pattern.test(content)) {
      logger.warn({ reason: label }, 'Output validation failed - secret leak');
      return { safe: false, reason: label };
    }
  }

  // 2. Check for injection echo (only when threats were detected)
  // Skip if the LLM is clearly refusing the injection - avoids false positives
  // on legitimate refusals like "I cannot enter developer mode"
  if (detectedThreats && detectedThreats.length > 0 && !isRefusal(content)) {
    for (const echoPattern of INJECTION_ECHO_PATTERNS) {
      if (echoPattern.test(content)) {
        const reason = 'Injection echo detected in output';
        logger.warn(
          { reason, detectedThreats },
          'Output validation failed - injection echo',
        );
        return { safe: false, reason };
      }
    }
  }

  return { safe: true, reason: null };
}