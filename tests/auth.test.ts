import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockFindOne = vi.fn();

vi.mock('../src/services/mongo.js', () => ({
  getApiKeysCollection: () => ({ findOne: mockFindOne }),
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { hashApiKey } from '../src/utils/crypto.js';
import { authMiddleware, adminOnly } from '../src/middleware/auth.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function mockReqResNext() {
  const req: any = {
    headers: {},
    correlationId: 'test-correlation-id',
  };
  const res: any = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
  const next = vi.fn();
  return { req, res, next };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('authMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when x-api-key header is missing', async () => {
    const { req, res, next } = mockReqResNext();

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'API key required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when API key is not found in database', async () => {
    const { req, res, next } = mockReqResNext();
    req.headers['x-api-key'] = 'unknown-key';
    mockFindOne.mockResolvedValueOnce(null);

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid API key' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when key hash does not match (constantTimeCompare fails)', async () => {
    const { req, res, next } = mockReqResNext();
    req.headers['x-api-key'] = 'some-key';

    // findOne returns a record whose keyHash does NOT match the hash of 'some-key'
    mockFindOne.mockResolvedValueOnce({
      keyHash: hashApiKey('different-key'),
      role: 'client',
      label: 'test-client',
    });

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid API key' });
    expect(next).not.toHaveBeenCalled();
  });

  it('attaches apiKeyId and apiKeyRole on valid key', async () => {
    const { req, res, next } = mockReqResNext();
    req.headers['x-api-key'] = 'valid-key';

    mockFindOne.mockResolvedValueOnce({
      keyHash: hashApiKey('valid-key'),
      role: 'client',
      label: 'test-client',
    });

    await authMiddleware(req, res, next);

    expect(req.apiKeyId).toBe('test-client');
    expect(req.apiKeyRole).toBe('client');
    expect(next).toHaveBeenCalled();
  });

  it('sets auditStartTime on valid key', async () => {
    const { req, res, next } = mockReqResNext();
    req.headers['x-api-key'] = 'valid-key';

    mockFindOne.mockResolvedValueOnce({
      keyHash: hashApiKey('valid-key'),
      role: 'client',
      label: 'test-client',
    });

    const before = Date.now();
    await authMiddleware(req, res, next);
    const after = Date.now();

    expect(req.auditStartTime).toBeGreaterThanOrEqual(before);
    expect(req.auditStartTime).toBeLessThanOrEqual(after);
  });
});

describe('adminOnly', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 for non-admin role', () => {
    const { req, res, next } = mockReqResNext();
    req.apiKeyRole = 'client';

    adminOnly(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Admin access required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next for admin role', () => {
    const { req, res, next } = mockReqResNext();
    req.apiKeyRole = 'admin';

    adminOnly(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
