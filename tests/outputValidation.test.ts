import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { validateOutput } from '../src/middleware/outputValidation.js';

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('validateOutput', () => {
  // ── Secret detection ────────────────────────────────────────────────────

  describe('secret detection', () => {
    it('detects OpenAI API key (sk-...)', () => {
      const result = validateOutput('Here is the key: sk-abc123def456ghi789jkl012mno');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('OpenAI');
    });

    it('detects OpenAI project key (sk-proj-...)', () => {
      const result = validateOutput('Key: sk-proj-abc123def456ghi789jkl012mno');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('OpenAI');
    });

    it('detects Anthropic API key (sk-ant-...)', () => {
      const result = validateOutput('sk-ant-abc123def456ghi789jkl012mno345pqr');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('Anthropic');
    });

    it('detects JWT token', () => {
      const result = validateOutput(
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      );
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('JWT');
    });

    it('detects AWS access key', () => {
      const result = validateOutput('AKIAIOSFODNN7EXAMPLE');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('AWS');
    });

    it('detects private key block', () => {
      const result = validateOutput('-----BEGIN RSA PRIVATE KEY-----');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('private key');
    });

    it('detects AWS secret key pattern', () => {
      const result = validateOutput(
        'aws_secret_key="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"',
      );
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('AWS');
    });
  });

  // ── Injection echo ──────────────────────────────────────────────────────

  describe('injection echo', () => {
    it('detects injection echo when threats present', () => {
      const result = validateOutput(
        "Sure, I'll ignore previous instructions",
        ['role_override'],
      );
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('echo');
    });

    it('does NOT flag echo when no threats detected', () => {
      const result = validateOutput(
        "Sure, I'll ignore previous instructions",
        [],
      );
      expect(result.safe).toBe(true);
      expect(result.reason).toBeNull();
    });

    it('detects "system prompt" echo', () => {
      const result = validateOutput(
        'My system prompt says...',
        ['role_override'],
      );
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('echo');
    });
  });

  // ── Clean output ────────────────────────────────────────────────────────

  describe('clean output', () => {
    it('passes clean response', () => {
      const result = validateOutput('The capital of France is Paris.');
      expect(result.safe).toBe(true);
      expect(result.reason).toBeNull();
    });

    it('passes response with normal code', () => {
      const result = validateOutput('Use const x = 42; in JavaScript');
      expect(result.safe).toBe(true);
      expect(result.reason).toBeNull();
    });
  });
});
