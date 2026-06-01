import type { Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { AuthenticatedRequest } from '../types.js';
import { getRedisClient } from '../services/redis.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Sliding-window rate limiter middleware using Redis sorted sets.
 *
 * Algorithm:
 *   1. Each request is scored by its timestamp and stored in a sorted set
 *      keyed by `rate:{apiKeyId}`.
 *   2. Entries outside the sliding window are pruned.
 *   3. If the remaining count meets or exceeds the limit, the request is
 *      rejected with 429 and a `Retry-After` header.
 *   4. Otherwise the request is added and execution continues.
 *
 * The per-key rate limit can be overridden via `ApiKeyRecord.rateLimit`;
 * the default comes from `config.RATE_LIMIT_MAX`.
 */
export async function rateLimiterMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const redis = getRedisClient();
    const apiKeyId = req.apiKeyId ?? 'anonymous';
    const redisKey = `rate:${apiKeyId}`;
    const now = Date.now();
    const windowMs = config.RATE_LIMIT_WINDOW_MS;
    const windowStart = now - windowMs;

    // Use the correlation ID if available, otherwise generate a unique member ID
    const memberId = req.correlationId ?? uuidv4();

    // Determine the applicable rate limit.
    // A per-key override could be loaded from the API key record in Mongo,
    // but for simplicity we use config.RATE_LIMIT_MAX as the default.
    const maxRequests = config.RATE_LIMIT_MAX;

    // Execute the sliding window check atomically via a Redis pipeline
    const pipeline = redis.multi();

    // 1. Remove entries outside the current window
    pipeline.zRemRangeByScore(redisKey, 0, windowStart);

    // 2. Count remaining entries within the window
    pipeline.zCard(redisKey);

    // 3. Add the current request (score = timestamp, member = unique ID)
    pipeline.zAdd(redisKey, { score: now, value: memberId });

    // 4. Set TTL for automatic cleanup (2× window to be safe)
    pipeline.pExpire(redisKey, windowMs * 2);

    const results = await pipeline.exec();

    // results[1] is the ZCARD result — the count BEFORE we added the current request
    const currentCount = (results?.[1] as unknown as number) ?? 0;

    if (currentCount >= maxRequests) {
      // Remove the entry we just optimistically added
      await redis.zRem(redisKey, memberId);

      const retryAfterSeconds = Math.ceil(windowMs / 1000);

      logger.warn(
        { apiKeyId, currentCount, maxRequests, correlationId: req.correlationId },
        'Rate limit exceeded',
      );

      res.set('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        error: 'Too many requests',
        retryAfter: retryAfterSeconds,
      });
      return;
    }

    next();
  } catch (err) {
    // If Redis is unavailable, fail open with a warning rather than
    // blocking all traffic. In production you may want to fail closed.
    logger.error({ err, correlationId: req.correlationId }, 'Rate limiter error — allowing request');
    next();
  }
}
