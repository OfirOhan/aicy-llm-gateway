import { Router, type Response } from 'express';
import { ChatRequestSchema } from '../types.js';
import type { AuthenticatedRequest, AuditRecord } from '../types.js';
import { callLLM } from '../services/llmProvider.js';
import { validateOutput } from '../middleware/outputValidation.js';
import { hashContent } from '../utils/crypto.js';
import { logAudit } from '../services/auditLog.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * POST /v1/chat
 *
 * Accepts a validated ChatRequest, forwards sanitized messages to the
 * appropriate LLM provider, validates the response, and logs an audit record.
 */
router.post('/', async (req, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const startTime = authReq.auditStartTime ?? Date.now();

  // ── 1. Validate request body with Zod ─────────────────────────────────
  const parseResult = ChatRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: 'Invalid request body',
      details: parseResult.error.issues,
    });
    return;
  }

  const body = parseResult.data;

  // ── 2. Use sanitized messages (PII-redacted) or fall back to raw ──────
  const messages = authReq.sanitizedMessages ?? body.messages;

  // Base audit fields shared across success / failure paths
  const baseAudit = {
    timestamp: new Date(),
    apiKeyId: authReq.apiKeyId ?? 'unknown',
    model: body.model,
    correlationId: authReq.correlationId ?? 'unknown',
    detectedThreats: authReq.detectedThreats ?? [],
    ...(authReq.piiTokenMap ? { piiTokens: authReq.piiTokenMap } : {}),
  };

  try {
    // ── 3. Call the LLM provider ──────────────────────────────────────────
    let llmResponse;
    try {
      llmResponse = await callLLM(body.model, messages, body.max_tokens);
    } catch (err) {
      // Provider not configured → 503
      if (err instanceof Error && err.message.startsWith('Provider not configured')) {
        res.status(503).json({ error: 'LLM provider not configured' });

        await logAudit({
          ...baseAudit,
          requestHash: hashContent(JSON.stringify(messages)),
          responseHash: '',
          latencyMs: Date.now() - startTime,
          status: 'error',
          statusCode: 503,
        });
        return;
      }
      throw err; // re-throw other errors to the outer catch
    }

    // ── 4. Output validation ────────────────────────────────────────────
    const validation = validateOutput(llmResponse.content, authReq.detectedThreats ?? []);

    const requestHash = hashContent(JSON.stringify(messages));
    const responseHash = hashContent(llmResponse.content);

    if (!validation.safe) {
      res.status(422).json({
        error: 'Response blocked by output validation',
        reason: validation.reason,
      });

      await logAudit({
        ...baseAudit,
        requestHash,
        responseHash,
        latencyMs: Date.now() - startTime,
        status: 'blocked',
        statusCode: 422,
      });
      return;
    }

    // ── 5. Success ──────────────────────────────────────────────────────
    await logAudit({
      ...baseAudit,
      requestHash,
      responseHash,
      latencyMs: Date.now() - startTime,
      status: 'allowed',
      statusCode: 200,
    });

    res.status(200).json({
      id: llmResponse.id,
      model: llmResponse.model,
      content: llmResponse.content,
      usage: llmResponse.usage,
    });
  } catch (err) {
    // ── 6. Unexpected error ───────────────────────────────────────────────
    logger.error({ err, correlationId: authReq.correlationId }, 'Chat request failed');

    await logAudit({
      ...baseAudit,
      requestHash: hashContent(JSON.stringify(messages)),
      responseHash: '',
      latencyMs: Date.now() - startTime,
      status: 'error',
      statusCode: 500,
    });

    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
