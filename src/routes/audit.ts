import { Router, type Response } from 'express';
import type { AuthenticatedRequest } from '../types.js';
import { queryAuditLogs } from '../services/auditLog.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * GET /v1/audit
 *
 * Admin-only endpoint. Returns audit log records from the given `since`
 * timestamp, newest first. The `adminOnly` middleware is applied when this
 * router is mounted in index.ts.
 *
 * Query params:
 *   - since  (required) — ISO 8601 timestamp
 *   - limit  (optional) — max records, default 100, hard cap 500
 */
router.get('/', async (req, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;

  // ── Validate `since` param ────────────────────────────────────────────
  const sinceParam = req.query['since'] as string | undefined;
  if (!sinceParam) {
    res.status(400).json({ error: 'Missing required query parameter: since' });
    return;
  }

  const sinceDate = new Date(sinceParam);
  if (isNaN(sinceDate.getTime())) {
    res.status(400).json({ error: 'Invalid date format for parameter: since' });
    return;
  }

  // ── Parse & clamp `limit` ─────────────────────────────────────────────
  const rawLimit = parseInt(req.query['limit'] as string, 10);
  const limit = isNaN(rawLimit) ? 100 : Math.min(Math.max(rawLimit, 1), 500);

  try {
    const records = await queryAuditLogs(sinceDate, limit);
    res.status(200).json(records);
  } catch (err) {
    logger.error({ err, correlationId: authReq.correlationId }, 'Failed to query audit logs');
    res.status(500).json({ error: 'Failed to retrieve audit logs' });
  }
});

export default router;
