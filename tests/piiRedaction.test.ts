import { describe, it, expect } from 'vitest';
import { redactPii, restorePii } from '../src/middleware/piiRedaction.js';

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('redactPii', () => {
  // ── Email redaction ───────────────────────────────────────────────────────

  describe('email redaction', () => {
    it('redacts a standard email address', () => {
      const { redacted, tokenMap } = redactPii('Contact user@example.com for details');

      expect(redacted).not.toContain('user@example.com');
      expect(redacted).toMatch(/\[PII:EMAIL:[\w-]+\]/);

      // Token map should contain the original value
      const tokens = Object.values(tokenMap);
      expect(tokens).toContain('user@example.com');
    });

    it('redacts multiple emails', () => {
      const { redacted, tokenMap } = redactPii(
        'Send to alice@test.com and bob@example.org',
      );

      expect(redacted).not.toContain('alice@test.com');
      expect(redacted).not.toContain('bob@example.org');
      expect(Object.keys(tokenMap).length).toBe(2);
    });

    it('redacts email with subdomain', () => {
      const { redacted } = redactPii('Email a@sub.domain.co.il now');

      expect(redacted).not.toContain('a@sub.domain.co.il');
      expect(redacted).toMatch(/\[PII:EMAIL:[\w-]+\]/);
    });
  });

  // ── Phone redaction ───────────────────────────────────────────────────────

  describe('phone redaction', () => {
    it('redacts Israeli mobile (local format)', () => {
      const { redacted, tokenMap } = redactPii('Call 054-123-4567');

      expect(redacted).not.toContain('054-123-4567');
      expect(redacted).toMatch(/\[PII:PHONE:[\w-]+\]/);

      const tokens = Object.values(tokenMap);
      expect(tokens).toContain('054-123-4567');
    });

    it('redacts Israeli mobile (+972 format)', () => {
      const { redacted } = redactPii('Call +972-54-123-4567');

      expect(redacted).not.toContain('+972-54-123-4567');
      expect(redacted).toMatch(/\[PII:PHONE:[\w-]+\]/);
    });

    it('redacts Israeli mobile without dashes', () => {
      const { redacted } = redactPii('0541234567');

      expect(redacted).not.toContain('0541234567');
      expect(redacted).toMatch(/\[PII:PHONE:[\w-]+\]/);
    });

    it('redacts Israeli landline', () => {
      const { redacted } = redactPii('Call 02-1234567');

      expect(redacted).not.toContain('02-1234567');
      expect(redacted).toMatch(/\[PII:PHONE:[\w-]+\]/);
    });

    it('redacts international phone', () => {
      const { redacted } = redactPii('+1-5551234567');

      expect(redacted).not.toContain('+1-5551234567');
      expect(redacted).toMatch(/\[PII:PHONE:[\w-]+\]/);
    });
  });

  // ── Israeli ID redaction ──────────────────────────────────────────────────

  describe('Israeli ID redaction', () => {
    it('redacts valid Israeli ID', () => {
      // 123456782 is a valid Israeli ID (Luhn-like check digit passes)
      const { redacted, tokenMap } = redactPii('ID: 123456782');

      expect(redacted).not.toContain('123456782');
      expect(redacted).toMatch(/\[PII:ID:[\w-]+\]/);

      const tokens = Object.values(tokenMap);
      expect(tokens).toContain('123456782');
    });

    it('does NOT redact invalid 9-digit number', () => {
      // 999999999 — check digit fails (sum = 81, 81 % 10 ≠ 0)
      const { redacted, tokenMap } = redactPii('Number: 999999999');

      expect(redacted).toContain('999999999');
      // No ID token should be generated
      const idTokens = Object.keys(tokenMap).filter((k) => k.includes('PII:ID'));
      expect(idTokens.length).toBe(0);
    });

    it('does NOT redact 8-digit number', () => {
      const { redacted, tokenMap } = redactPii('Code: 12345678');

      expect(redacted).toContain('12345678');
      const idTokens = Object.keys(tokenMap).filter((k) => k.includes('PII:ID'));
      expect(idTokens.length).toBe(0);
    });
  });

  // ── Reversibility ─────────────────────────────────────────────────────────

  describe('reversibility', () => {
    it('restorePii reverses redaction', () => {
      const original = 'Contact user@example.com or call 054-123-4567';
      const { redacted, tokenMap } = redactPii(original);
      const restored = restorePii(redacted, tokenMap);

      expect(restored).toBe(original);
    });

    it('restorePii with empty token map returns original', () => {
      const text = 'No PII here at all';
      const restored = restorePii(text, {});

      expect(restored).toBe(text);
    });
  });

  // ── Mixed PII ─────────────────────────────────────────────────────────────

  describe('mixed PII', () => {
    it('redacts email, phone, and ID in same text', () => {
      const input = 'Email: test@test.com, Phone: 054-555-1234, ID: 123456782';
      const { redacted, tokenMap } = redactPii(input);

      expect(redacted).not.toContain('test@test.com');
      expect(redacted).not.toContain('054-555-1234');
      expect(redacted).not.toContain('123456782');

      expect(redacted).toMatch(/\[PII:EMAIL:[\w-]+\]/);
      expect(redacted).toMatch(/\[PII:PHONE:[\w-]+\]/);
      expect(redacted).toMatch(/\[PII:ID:[\w-]+\]/);

      // Verify all original values are in the token map
      const values = Object.values(tokenMap);
      expect(values).toContain('test@test.com');
      expect(values).toContain('054-555-1234');
      expect(values).toContain('123456782');
    });
  });
});
