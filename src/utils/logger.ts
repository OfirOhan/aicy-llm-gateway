import pino from 'pino';
import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { AuthenticatedRequest } from '../types.js';

/**
 * Structured logger with pino.
 * Redacts sensitive fields so secrets never appear in logs.
 */
const loggerOptions: pino.LoggerOptions = {
  level: process.env['LOG_LEVEL'] ?? 'info',
  redact: {
    paths: [
      'req.headers["x-api-key"]',
      'req.headers.authorization',
      'apiKey',
      'password',
      'secret',
    ],
    censor: '[REDACTED]',
  },
};

if (process.env['NODE_ENV'] !== 'production') {
  loggerOptions.transport = { target: 'pino-pretty', options: { colorize: true } };
}

export const logger = pino(loggerOptions);

/**
 * Middleware that attaches a correlation ID (UUID v4) to every request.
 * The correlation ID is set in the response header and attached to req for
 * downstream use in audit logging and structured log entries.
 */
export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const correlationId = uuidv4();
  (req as AuthenticatedRequest).correlationId = correlationId;
  res.setHeader('x-correlation-id', correlationId);
  next();
}
