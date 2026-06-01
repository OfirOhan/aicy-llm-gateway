import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuditRecord } from '../src/types.js';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockInsertOne = vi.fn();
const mockToArray = vi.fn();
const mockLimit = vi.fn(() => ({ toArray: mockToArray }));
const mockSort = vi.fn(() => ({ limit: mockLimit }));
const mockFind = vi.fn(() => ({ sort: mockSort }));

vi.mock('../src/services/mongo.js', () => ({
  getAuditLogsCollection: () => ({
    insertOne: mockInsertOne,
    find: mockFind,
  }),
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { logAudit, queryAuditLogs } from '../src/services/auditLog.js';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const sampleRecord: AuditRecord = {
  timestamp: new Date(),
  apiKeyId: 'test-key',
  model: 'gpt-4o',
  requestHash: 'abc123',
  responseHash: 'def456',
  detectedThreats: [],
  latencyMs: 150,
  status: 'allowed',
  correlationId: 'test-correlation',
  statusCode: 200,
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('logAudit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts record into collection', async () => {
    mockInsertOne.mockResolvedValueOnce({ acknowledged: true });

    await logAudit(sampleRecord);

    expect(mockInsertOne).toHaveBeenCalledWith(sampleRecord);
  });

  it('does not throw on error', async () => {
    mockInsertOne.mockRejectedValueOnce(new Error('Mongo write failed'));

    // Should not throw — errors are swallowed and logged
    await expect(logAudit(sampleRecord)).resolves.toBeUndefined();
  });
});

describe('queryAuditLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the chainable mock returns
    mockFind.mockReturnValue({ sort: mockSort });
    mockSort.mockReturnValue({ limit: mockLimit });
    mockLimit.mockReturnValue({ toArray: mockToArray });
    mockToArray.mockResolvedValue([]);
  });

  it('queries with correct filter and sort', async () => {
    const since = new Date('2025-01-01');
    mockToArray.mockResolvedValueOnce([sampleRecord]);

    const results = await queryAuditLogs(since, 100);

    expect(mockFind).toHaveBeenCalledWith({ timestamp: { $gte: since } });
    expect(mockSort).toHaveBeenCalledWith({ timestamp: -1 });
    expect(mockLimit).toHaveBeenCalledWith(100);
    expect(results).toEqual([sampleRecord]);
  });

  it('clamps limit to 500', async () => {
    const since = new Date('2025-01-01');
    mockToArray.mockResolvedValueOnce([]);

    await queryAuditLogs(since, 1000);

    expect(mockLimit).toHaveBeenCalledWith(500);
  });
});
