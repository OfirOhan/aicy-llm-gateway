import { createClient, type RedisClientType } from 'redis';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

let client: RedisClientType | null = null;

/**
 * Connect to Redis. Reuses existing connection if already connected.
 */
export async function connectRedis(): Promise<RedisClientType> {
  if (client?.isOpen) return client;

  client = createClient({ url: config.REDIS_URL }) as RedisClientType;

  client.on('error', (err) => {
    logger.error({ err }, 'Redis connection error');
  });

  await client.connect();
  logger.info('✅ Connected to Redis');
  return client;
}

/**
 * Get the Redis client (must be connected first).
 */
export function getRedisClient(): RedisClientType {
  if (!client?.isOpen) throw new Error('Redis not connected');
  return client;
}

/**
 * Check if Redis is reachable.
 */
export async function isRedisConnected(): Promise<boolean> {
  try {
    if (!client?.isOpen) return false;
    await client.ping();
    return true;
  } catch {
    return false;
  }
}

/**
 * Graceful disconnect.
 */
export async function disconnectRedis(): Promise<void> {
  if (client?.isOpen) {
    await client.quit();
    client = null;
    logger.info('Redis disconnected');
  }
}
