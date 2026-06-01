import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '../types.js';
import { hashApiKey, constantTimeCompare } from '../utils/crypto.js';
import { getApiKeysCollection } from '../services/mongo.js';
import { logger } from '../utils/logger.js';

/**
 * Authentication middleware.
 *
 * Extracts the `x-api-key` header, hashes it, looks it up in the
 * `apiKeys` MongoDB collection, and performs a timing-safe comparison
 * of the hashed values. On success the authenticated identity is
 * attached to the request object for downstream middleware.
 */
export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // 1. Extract the API key from the request header
    const apiKey = req.headers['x-api-key'];

    if (!apiKey || typeof apiKey !== 'string') {
      res.status(401).json({ error: 'API key required' });
      return;
    }

    // 2. Hash the provided key and look up by keyHash in Mongo
    const hashedKey = hashApiKey(apiKey);
    const apiKeysCollection = getApiKeysCollection();
    const record = await apiKeysCollection.findOne({ keyHash: hashedKey });

    if (!record) {
      logger.warn({ correlationId: req.correlationId }, 'Authentication failed: API key not found');
      res.status(401).json({ error: 'Invalid API key' });
      return;
    }

    // 3. Timing-safe comparison to prevent timing-based side-channel attacks.
    //    Even though we already matched by hash in Mongo, this ensures the
    //    comparison itself does not leak information via response timing.
    if (!constantTimeCompare(hashedKey, record.keyHash)) {
      logger.warn({ correlationId: req.correlationId }, 'Authentication failed: timing-safe comparison mismatch');
      res.status(401).json({ error: 'Invalid API key' });
      return;
    }

    // 4. Attach identity information to the request
    req.apiKeyId = record.label ?? record._id?.toString();
    req.apiKeyRole = record.role;

    // 5. Record the start time for latency tracking in audit logs
    req.auditStartTime = Date.now();

    logger.info(
      { apiKeyId: req.apiKeyId, role: req.apiKeyRole, correlationId: req.correlationId },
      'Request authenticated',
    );

    next();
  } catch (err) {
    logger.error({ err, correlationId: req.correlationId }, 'Auth middleware error');
    res.status(500).json({ error: 'Internal authentication error' });
  }
}

/**
 * Admin-only authorization guard.
 *
 * Must be placed AFTER `authMiddleware` in the middleware chain.
 * Returns 403 if the authenticated user does not have the `admin` role.
 */
export function adminOnly(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  if (req.apiKeyRole !== 'admin') {
    logger.warn(
      { apiKeyId: req.apiKeyId, role: req.apiKeyRole, correlationId: req.correlationId },
      'Admin access denied',
    );
    res.status(403).json({ error: 'Admin access required' });
    return;
  }

  next();
}
