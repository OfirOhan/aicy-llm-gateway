import { getAuditLogsCollection } from './mongo.js';
import { logger } from '../utils/logger.js';
import type { AuditRecord } from '../types.js';

/**
 * Insert an audit record into the `auditLogs` collection.
 * Errors are logged but never thrown — audit logging must not crash a request.
 */
export async function logAudit(record: AuditRecord): Promise<void> {
  try {
    const collection = getAuditLogsCollection();
    await collection.insertOne(record);
  } catch (err) {
    logger.error({ err, correlationId: record.correlationId }, 'Failed to write audit log');
  }
}

/**
 * Query audit logs since a given timestamp, sorted newest-first.
 * Limit is clamped to a maximum of 500 records.
 */
export async function queryAuditLogs(
  since: Date,
  limit: number,
): Promise<AuditRecord[]> {
  const clampedLimit = Math.min(Math.max(limit, 1), 500);

  const collection = getAuditLogsCollection();
  return collection
    .find({ timestamp: { $gte: since } })
    .sort({ timestamp: -1 })
    .limit(clampedLimit)
    .toArray();
}
