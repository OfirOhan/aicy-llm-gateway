import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import type { ChatMessage, ChatResponse } from '../types.js';

// ─── Anthropic types (subset of the Messages API response) ──────────────────
interface AnthropicResponse {
  id: string;
  content: { type: string; text: string }[];
  usage: { input_tokens: number; output_tokens: number };
}

// ─── OpenAI types (subset of Chat Completions response) ─────────────────────
interface OpenAIResponse {
  id: string;
  choices: { message: { content: string } }[];
  usage: { prompt_tokens: number; completion_tokens: number };
}

/**
 * Call an LLM provider based on the model prefix.
 *
 * - `claude-*` → Anthropic Messages API
 * - `gpt-*`   → OpenAI Chat Completions API
 *
 * Uses native `fetch` (Node 18+). No external SDKs.
 */
export async function callLLM(
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
): Promise<ChatResponse> {
  if (model.startsWith('claude-')) {
    return callAnthropic(model, messages, maxTokens);
  }

  if (model.startsWith('gpt-')) {
    return callOpenAI(model, messages, maxTokens);
  }

  throw new Error(`Unsupported model: ${model}`);
}

/**
 * Check whether the required API key for a given model is configured.
 */
export function isProviderAvailable(model: string): boolean {
  if (model.startsWith('claude-')) {
    return Boolean(config.ANTHROPIC_API_KEY);
  }
  if (model.startsWith('gpt-')) {
    return Boolean(config.OPENAI_API_KEY);
  }
  return false;
}

// ─── Private helpers ────────────────────────────────────────────────────────

async function callAnthropic(
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
): Promise<ChatResponse> {
  if (!config.ANTHROPIC_API_KEY) {
    throw new Error('Provider not configured: anthropic');
  }

  logger.info({ model, maxTokens }, 'Calling Anthropic Messages API');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': config.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as AnthropicResponse;

  const firstContent = data.content[0];
  if (!firstContent) {
    throw new Error('Anthropic returned empty content array');
  }

  return {
    id: data.id,
    model,
    content: firstContent.text,
    usage: {
      prompt_tokens: data.usage.input_tokens,
      completion_tokens: data.usage.output_tokens,
    },
  };
}

async function callOpenAI(
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
): Promise<ChatResponse> {
  if (!config.OPENAI_API_KEY) {
    throw new Error('Provider not configured: openai');
  }

  logger.info({ model, maxTokens }, 'Calling OpenAI Chat Completions API');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as OpenAIResponse;

  const firstChoice = data.choices[0];
  if (!firstChoice) {
    throw new Error('OpenAI returned empty choices array');
  }

  return {
    id: data.id,
    model,
    content: firstChoice.message.content,
    usage: {
      prompt_tokens: data.usage.prompt_tokens,
      completion_tokens: data.usage.completion_tokens,
    },
  };
}
