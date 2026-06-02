/// <reference types="node" />
import { MongoClient } from 'mongodb';
import { hashApiKey } from '../src/utils/crypto.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/securellm';

const TEST_KEYS = [
  {
    plaintext: 'test-client-key-123',
    role: 'client' as const,
    label: 'test-client',
  },
  {
    plaintext: 'test-admin-key-456',
    role: 'admin' as const,
    label: 'test-admin',
  },
];

async function seed(): Promise<void> {
  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    console.log(`✅ Connected to MongoDB at ${MONGO_URI}`);

    const db = client.db();
    const collection = db.collection('apiKeys');

    for (const key of TEST_KEYS) {
      const keyHash = hashApiKey(key.plaintext);

      await collection.updateOne(
        { keyHash },
        {
          $set: {
            keyHash,
            role: key.role,
            label: key.label,
          },
          $setOnInsert: {
            createdAt: new Date(),
          },
        },
        { upsert: true },
      );

      console.log(`🔑 Upserted ${key.role} key: ${key.plaintext}  (label: ${key.label})`);
    }

    console.log('\n📋 Test API keys ready to use:');
    console.log('   Client key: test-client-key-123');
    console.log('   Admin key:  test-admin-key-456');
  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

seed();
