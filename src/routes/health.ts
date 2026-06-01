import { Router, type Request, type Response } from 'express';
import { isMongoConnected } from '../services/mongo.js';
import { isRedisConnected } from '../services/redis.js';
import { isProviderAvailable } from '../services/llmProvider.js';

const router = Router();

/**
 * GET /healthz
 *
 * Unauthenticated health-check endpoint.
 * Returns connectivity status for MongoDB, Redis, and LLM providers.
 *
 * Status is `ok` when both Mongo AND Redis are reachable.
 * Provider availability is reported but does not affect the overall status.
 */
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  const [mongo, redis] = await Promise.all([
    isMongoConnected(),
    isRedisConnected(),
  ]);

  const anthropic = isProviderAvailable('claude-3-5-sonnet');
  const openai = isProviderAvailable('gpt-4o');

  const status = mongo && redis ? 'ok' : 'degraded';

  res.status(status === 'ok' ? 200 : 503).json({
    status,
    mongo,
    redis,
    providers: {
      anthropic,
      openai,
    },
    timestamp: new Date().toISOString(),
  });
});

export default router;
