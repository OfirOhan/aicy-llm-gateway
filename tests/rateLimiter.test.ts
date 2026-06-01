import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockPipeline = {
  zRemRangeByScore: vi.fn().mockReturnThis(),
  zCard: vi.fn().mockReturnThis(),
  zAdd: vi.fn().mockReturnThis(),
  pExpire: vi.fn().mockReturnThis(),
  exec: vi.fn(),
};

const mockRedisClient = {
  multi: vi.fn(() => mockPipeline),
  zRem: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../src/services/redis.js', () => ({
  getRedisClient: () => mockRedisClient,
}));

vi.mock('../src/config.js', () => ({
  config: {
    RATE_LIMIT_WINDOW_MS: 60000,
    RATE_LIMIT_MAX: 3,
  },
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { rateLimiterMiddleware } from '../src/middleware/rateLimiter.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function mockReqResNext() {
  const req: any = {
    apiKeyId: 'test-key',
    correlationId: 'test-correlation-id',
  };
  const res: any = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    set: vi.fn(),
  };
  const next = vi.fn();
  return { req, res, next };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('rateLimiterMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows request when under limit', async () => {
    const { req, res, next } = mockReqResNext();
    mockPipeline.exec.mockResolvedValueOnce([null, 1, null, null]);

    await rateLimiterMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 429 when rate limit exceeded', async () => {
    const { req, res, next } = mockReqResNext();
    mockPipeline.exec.mockResolvedValueOnce([null, 3, null, null]);

    await rateLimiterMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Too many requests' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('sets Retry-After header when rate limited', async () => {
    const { req, res, next } = mockReqResNext();
    mockPipeline.exec.mockResolvedValueOnce([null, 3, null, null]);

    await rateLimiterMiddleware(req, res, next);

    expect(res.set).toHaveBeenCalledWith('Retry-After', '60');
  });

  it('allows request through on Redis error (fail open)', async () => {
    const { req, res, next } = mockReqResNext();
    mockPipeline.exec.mockRejectedValueOnce(new Error('Redis connection lost'));

    await rateLimiterMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
