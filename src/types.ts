import type { Request } from 'express';
import { z } from 'zod/v4';

// ─── API Key ────────────────────────────────────────────────────────────────
export type Role = 'client' | 'admin';

export interface ApiKeyRecord {
  _id?: string;
  keyHash: string;
  role: Role;
  label: string;
  rateLimit?: number; // per-key override (req/min)
  createdAt: Date;
}

// ─── Chat Request / Response ────────────────────────────────────────────────
export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
});

export const ChatRequestSchema = z.object({
  model: z.string().regex(/^(claude-|gpt-)/, 'Model must start with "claude-" or "gpt-"'),
  messages: z.array(ChatMessageSchema).min(1),
  max_tokens: z.number().int().positive().max(4096).optional().default(1024),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export interface ChatResponse {
  id: string;
  model: string;
  content: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

// ─── PII Token Map ──────────────────────────────────────────────────────────
export interface PiiTokenMap {
  [token: string]: string; // e.g. "[PII:EMAIL:abc123]" -> "user@example.com"
}

// ─── Audit Record ───────────────────────────────────────────────────────────
export type AuditStatus = 'allowed' | 'blocked' | 'error';

export interface AuditRecord {
  timestamp: Date;
  apiKeyId: string;
  model: string;
  requestHash: string;
  responseHash: string;
  detectedThreats: string[];
  piiTokens?: PiiTokenMap;
  latencyMs: number;
  status: AuditStatus;
  correlationId: string;
  statusCode: number;
}

// ─── Extended Express Request ───────────────────────────────────────────────
export interface AuthenticatedRequest extends Request {
  apiKeyId?: string;
  apiKeyRole?: Role;
  correlationId?: string;
  piiTokenMap?: PiiTokenMap;
  detectedThreats?: string[];
  auditStartTime?: number;
  sanitizedMessages?: ChatMessage[];
}
