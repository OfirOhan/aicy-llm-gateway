import express from 'express';
import { config } from './config.js';
import { logger, correlationIdMiddleware } from './utils/logger.js';
import { connectMongo, disconnectMongo } from './services/mongo.js';
import { connectRedis, disconnectRedis } from './services/redis.js';

// ─── Middleware ──────────────────────────────────────────────────────────────
import { authMiddleware, adminOnly } from './middleware/auth.js';
import { rateLimiterMiddleware } from './middleware/rateLimiter.js';
import { promptInjectionMiddleware } from './middleware/promptInjection.js';
import { piiRedactionMiddleware } from './middleware/piiRedaction.js';

// ─── Routes ─────────────────────────────────────────────────────────────────
import healthRouter from './routes/health.js';
import auditRouter from './routes/audit.js';
import chatRouter from './routes/chat.js';

// ─── Bootstrap ──────────────────────────────────────────────────────────────

const app = express();

// Parse JSON bodies
app.use(express.json());

// Attach a unique correlation ID to every request
app.use(correlationIdMiddleware);

// ── Health check — NO auth required ─────────────────────────────────────────
app.use('/healthz', healthRouter);

// ── Auth & rate limiting apply to everything below ──────────────────────────
app.use(authMiddleware);
app.use(rateLimiterMiddleware);

// ── Audit route — admin-only (no injection / PII middleware) ────────────────
app.use('/v1/audit', adminOnly, auditRouter);

// ── Prompt-injection & PII redaction — only relevant for chat ───────────────
app.use(promptInjectionMiddleware);
app.use(piiRedactionMiddleware);

// ── Chat route ──────────────────────────────────────────────────────────────
app.use('/v1/chat', chatRouter);

// ─── Start server ───────────────────────────────────────────────────────────

let server: ReturnType<typeof app.listen>;

async function start(): Promise<void> {
  try {
    await connectMongo();
    await connectRedis();

    server = app.listen(config.PORT, () => {
      logger.info({ port: config.PORT }, '🚀 AICY LLM Gateway is running');
    });
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }
}

// ─── Graceful shutdown ──────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Received shutdown signal — cleaning up…');

  // Stop accepting new connections
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  await disconnectMongo();
  await disconnectRedis();

  logger.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start();
