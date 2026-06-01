import { MongoClient, type Collection, type Db } from 'mongodb';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import type { ApiKeyRecord, AuditRecord } from '../types.js';

let client: MongoClient | null = null;
let db: Db | null = null;

/**
 * Connect to MongoDB. Reuses existing connection if already connected.
 */
export async function connectMongo(): Promise<Db> {
  if (db) return db;

  client = new MongoClient(config.MONGO_URI);
  await client.connect();
  db = client.db();

  // Create indexes for performance
  await db.collection('apiKeys').createIndex({ keyHash: 1 }, { unique: true });
  await db.collection('auditLogs').createIndex({ timestamp: -1 });
  await db.collection('auditLogs').createIndex({ apiKeyId: 1, timestamp: -1 });

  logger.info('✅ Connected to MongoDB');
  return db;
}

/**
 * Get the apiKeys collection.
 */
export function getApiKeysCollection(): Collection<ApiKeyRecord> {
  if (!db) throw new Error('MongoDB not connected');
  return db.collection<ApiKeyRecord>('apiKeys');
}

/**
 * Get the auditLogs collection.
 */
export function getAuditLogsCollection(): Collection<AuditRecord> {
  if (!db) throw new Error('MongoDB not connected');
  return db.collection<AuditRecord>('auditLogs');
}

/**
 * Check if MongoDB is reachable.
 */
export async function isMongoConnected(): Promise<boolean> {
  try {
    if (!client) return false;
    await client.db().admin().ping();
    return true;
  } catch {
    return false;
  }
}

/**
 * Graceful disconnect.
 */
export async function disconnectMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    logger.info('MongoDB disconnected');
  }
}
