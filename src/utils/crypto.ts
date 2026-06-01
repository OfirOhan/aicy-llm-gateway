import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Hash an API key using SHA-256.
 * Used for storing and comparing keys without keeping plaintext.
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Both strings are hashed first to ensure equal length,
 * then compared using Node's timingSafeEqual.
 */
export function constantTimeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(createHash('sha256').update(a).digest('hex'));
  const bufB = Buffer.from(createHash('sha256').update(b).digest('hex'));
  return timingSafeEqual(bufA, bufB);
}

/**
 * Hash content using SHA-256 for audit record storage.
 */
export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
