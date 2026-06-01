import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest, ChatMessage } from '../types.js';
import { logger } from '../utils/logger.js';

// ─── Detection Result ───────────────────────────────────────────────────────

interface InjectionDetectionResult {
  detected: boolean;
  category: string | null;
}

// ─── Pattern Categories ─────────────────────────────────────────────────────

/**
 * Category 1: Role override / system prompt extraction
 *
 * Detects attempts to override the model's system instructions,
 * extract the system prompt, or force an identity change.
 */
const ROLE_OVERRIDE_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+|your\s+|previous\s+|prior\s+)?instructions/i,
  /ignore\s+(all\s+|your\s+|previous\s+|prior\s+)?rules/i,
  /disregard\s+(all\s+|your\s+|previous\s+)?(instructions|rules|guidelines)/i,
  /you\s+are\s+now/i,
  /act\s+as\s+if\s+you/i,
  /pretend\s+you\s+are/i,
  /reveal\s+your\s+(system\s+|initial\s+)?prompt/i,
  /show\s+(me\s+)?your\s+(system\s+|initial\s+)?prompt/i,
  /what\s+(is|are)\s+your\s+(system\s+|initial\s+)?(prompt|instructions|rules)/i,
  /repeat\s+(your|the)\s+(system\s+|initial\s+)?(prompt|instructions)/i,
  /override\s+(your\s+|all\s+|previous\s+)?(instructions|rules|safety)/i,
  /forget\s+(your\s+|all\s+|previous\s+)?(instructions|rules|guidelines|training)/i,
  /new\s+instructions:?/i,
  /system:?\s/i,
];

/**
 * Category 2: Delimiter / encoding injection
 *
 * Detects manipulation of chat-template tokens, markdown delimiters,
 * or encoded payloads intended to confuse the model's parsing.
 */
const DELIMITER_INJECTION_PATTERNS: RegExp[] = [
  /###\s*(system|instruction|new|override|end|begin)/i,
  /<\|?(system|im_start|im_end|endof|startof)\|?>/i,
  /\[INST\]/i,
  /\[\/INST\]/i,
  /<s>/i,
  /<\/s>/i,
  /base64:\s*[A-Za-z0-9+/=]{20,}/i,
  /\\x[0-9a-f]{2}/i,
  /\\u[0-9a-f]{4}/i,
  /AAAA{4,}/i, // Repeated padding-like encoding
];

/**
 * Category 3: Jailbreak patterns
 *
 * Detects well-known jailbreak prompts, filter bypass attempts,
 * and social-engineering techniques (DAN, sudo mode, etc.).
 */
const JAILBREAK_PATTERNS: RegExp[] = [
  /\bDAN\b/,
  /do\s+anything\s+now/i,
  /jailbreak/i,
  /bypass\s+(your\s+|all\s+|safety\s+|content\s+)?filter/i,
  /(no|without|ignore|disable|remove)\s+(safety\s+|content\s+)?(filter|restriction|guardrail|limitation|moderation|censorship|rule)/i,
  /developer\s+mode/i,
  /god\s+mode/i,
  /sudo\s+mode/i,
  /pretend\s+you\s+have\s+no\s+(restriction|filter|limitation|rule|guideline)/i,
  /in\s+a\s+world\s+where\s+(there\s+are\s+no|you\s+have\s+no)\s+(rules|restrictions|filters)/i,
  /hypothetical(ly)?\s*.*no\s+(rules|restrictions|filters|limitations)/i,
  /opposite\s+day/i,
  /evil\s+(mode|version|twin)/i,
  /unfiltered\s+(mode|response|output)/i,
];

/** All categories bundled for iteration. */
const PATTERN_CATEGORIES: { name: string; patterns: RegExp[] }[] = [
  { name: 'role_override', patterns: ROLE_OVERRIDE_PATTERNS },
  { name: 'delimiter_injection', patterns: DELIMITER_INJECTION_PATTERNS },
  { name: 'jailbreak', patterns: JAILBREAK_PATTERNS },
];

// ─── Public Detection Function ──────────────────────────────────────────────

/**
 * Detect prompt-injection attempts in a piece of text.
 *
 * The text is normalised (lowercased, whitespace collapsed) before
 * scanning. Returns the first matching category or `null` if clean.
 *
 * Exported separately so it can be unit-tested independently of Express.
 */
export function detectPromptInjection(text: string): InjectionDetectionResult {
  // Normalise: lowercase + collapse multiple whitespace characters
  const normalised = text.toLowerCase().replace(/\s+/g, ' ').trim();

  for (const category of PATTERN_CATEGORIES) {
    for (const pattern of category.patterns) {
      if (pattern.test(normalised)) {
        return { detected: true, category: category.name };
      }
    }
  }

  return { detected: false, category: null };
}

// ─── Express Middleware ─────────────────────────────────────────────────────

/**
 * Prompt-injection guard middleware.
 *
 * Scans every message in `req.body.messages` for known injection
 * patterns across three categories. On first detection the request
 * is rejected with 400 and the category is logged.
 */
export function promptInjectionMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  try {
    const messages: ChatMessage[] | undefined = req.body?.messages;

    if (!messages || !Array.isArray(messages)) {
      // No messages to scan — let downstream validation handle schema issues
      next();
      return;
    }

    // Initialise the threats array if it doesn't exist yet
    if (!req.detectedThreats) {
      req.detectedThreats = [];
    }

    for (const message of messages) {
      if (!message.content || typeof message.content !== 'string') {
        continue;
      }

      const result = detectPromptInjection(message.content);

      if (result.detected) {
        req.detectedThreats.push(result.category!);

        logger.warn(
          {
            category: result.category,
            role: message.role,
            apiKeyId: req.apiKeyId,
            correlationId: req.correlationId,
          },
          'Prompt injection detected',
        );

        res.status(400).json({
          error: 'Prompt injection detected',
          category: result.category,
        });
        return;
      }
    }

    next();
  } catch (err) {
    logger.error({ err, correlationId: req.correlationId }, 'Prompt injection middleware error');
    res.status(500).json({ error: 'Internal prompt-injection check error' });
  }
}
