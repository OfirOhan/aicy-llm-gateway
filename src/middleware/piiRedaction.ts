import type { Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { AuthenticatedRequest, ChatMessage, PiiTokenMap } from '../types.js';
import { logger } from '../utils/logger.js';

// ─── PII Regex Patterns ─────────────────────────────────────────────────────

/**
 * Standard email address pattern.
 * Matches: user@example.com, first.last+tag@sub.domain.co.il
 */
const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

/**
 * Phone number patterns covering Israeli and international formats.
 *
 * Order matters — more specific patterns come first so they match
 * before the generic international catch-all.
 *
 *  - Israeli mobile:    054-123-4567  or  +972-54-123-4567
 *  - Israeli landline:  02-1234567    or  +972-2-1234567
 *  - International:     +1-555-1234567
 */
const PHONE_PATTERNS: RegExp[] = [
  /\+972[- ]?5\d[- ]?\d{3}[- ]?\d{4}/g,       // IL mobile  (+972)
  /05\d[- ]?\d{3}[- ]?\d{4}/g,                 // IL mobile  (local)
  /\+972[- ]?[2-9][- ]?\d{3}[- ]?\d{4}/g,      // IL landline (+972)
  /0[2-9][- ]?\d{3}[- ]?\d{4}/g,               // IL landline (local) — allows 03-555-0184
  /\+\d{1,3}[- ]?\d{1,4}[- ]?\d{1,4}[- ]?\d{1,9}/g, // International — allows +1-202-555-0143
];

/**
 * Israeli National ID (Teudat Zehut) — exactly 9 digits, word-bounded.
 * Candidate matches are validated with the Luhn-like Israeli check-digit
 * algorithm before redaction.
 */
const IL_ID_REGEX = /\b\d{9}\b/g;

// ─── Israeli ID Validation ──────────────────────────────────────────────────

/**
 * Validate an Israeli ID number using the Luhn-like check-digit algorithm.
 *
 * Algorithm:
 *   1. For each of the 9 digits, multiply alternating digits by 1 and 2.
 *   2. If the product is ≥ 10, sum its digits (equivalent to subtracting 9).
 *   3. Sum all results — a valid ID has a total divisible by 10.
 */
function isValidIsraeliId(id: string): boolean {
  if (id.length !== 9 || !/^\d{9}$/.test(id)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let digit = Number(id[i]) * ((i % 2) + 1);
    if (digit > 9) digit -= 9;
    sum += digit;
  }

  return sum % 10 === 0;
}

// ─── Core Redaction / Restoration ───────────────────────────────────────────

/**
 * Redact all recognised PII from a string.
 *
 * Returns the redacted text and a token map that can be used to
 * reverse the redaction later (e.g. during audit).
 *
 * Exported for independent unit testing.
 */
export function redactPii(text: string): { redacted: string; tokenMap: PiiTokenMap } {
  const tokenMap: PiiTokenMap = {};
  let redacted = text;

  // 1. Emails — replace first to avoid partial overlap with other patterns
  redacted = redacted.replace(EMAIL_REGEX, (match) => {
    const token = `[PII:EMAIL:${uuidv4()}]`;
    tokenMap[token] = match;
    return token;
  });

  // 2. Phone numbers — iterate patterns from most specific to least
  for (const pattern of PHONE_PATTERNS) {
    // Reset lastIndex because we reuse the global regex
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, (match) => {
      const token = `[PII:PHONE:${uuidv4()}]`;
      tokenMap[token] = match;
      return token;
    });
  }

  // 3. Israeli national IDs — only redact valid IDs (check-digit pass)
  IL_ID_REGEX.lastIndex = 0;
  redacted = redacted.replace(IL_ID_REGEX, (match) => {
    if (!isValidIsraeliId(match)) return match; // Leave invalid IDs untouched
    const token = `[PII:ID:${uuidv4()}]`;
    tokenMap[token] = match;
    return token;
  });

  return { redacted, tokenMap };
}

/**
 * Restore previously-redacted PII by replacing tokens with their
 * original values.
 *
 * Used at audit time to recover the original content when authorised.
 * Exported for unit testing.
 */
export function restorePii(text: string, tokenMap: PiiTokenMap): string {
  let restored = text;

  for (const [token, original] of Object.entries(tokenMap)) {
    restored = restored.replaceAll(token, original);
  }

  return restored;
}

// ─── Express Middleware ─────────────────────────────────────────────────────

/**
 * PII redaction middleware.
 *
 * Processes every message in `req.body.messages`, replaces PII with
 * opaque tokens, and stores the redacted messages in
 * `req.sanitizedMessages`. The original ↔ token mapping is kept in
 * `req.piiTokenMap` for downstream audit logging.
 */
export function piiRedactionMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  try {
    const messages: ChatMessage[] | undefined = req.body?.messages;

    if (!messages || !Array.isArray(messages)) {
      next();
      return;
    }

    const aggregatedTokenMap: PiiTokenMap = {};
    const sanitised: ChatMessage[] = [];

    for (const message of messages) {
      if (!message.content || typeof message.content !== 'string') {
        sanitised.push({ ...message });
        continue;
      }

      const { redacted, tokenMap } = redactPii(message.content);

      // Merge per-message tokens into the aggregate map
      Object.assign(aggregatedTokenMap, tokenMap);

      sanitised.push({ ...message, content: redacted });
    }

    // Attach results to the request for downstream consumption
    req.piiTokenMap = aggregatedTokenMap;
    req.sanitizedMessages = sanitised;

    const tokenCount = Object.keys(aggregatedTokenMap).length;
    if (tokenCount > 0) {
      logger.info(
        { tokenCount, correlationId: req.correlationId, apiKeyId: req.apiKeyId },
        'PII redacted from request messages',
      );
    }

    next();
  } catch (err) {
    logger.error({ err, correlationId: req.correlationId }, 'PII redaction middleware error');
    res.status(500).json({ error: 'Internal PII redaction error' });
  }
}
