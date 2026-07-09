import { describe, it, expect } from 'vitest';
import {
  RepoFullName,
  PrNumber,
  Severity,
  ListAgentsInput,
  GetFindingsInput,
} from '../../src/mcp/schemas.js';

describe('mcp schemas', () => {
  describe('RepoFullName', () => {
    it('accepts owner/name', () => {
      expect(RepoFullName.safeParse('acme/payments-api').success).toBe(true);
    });
    it('rejects a bare name (no slash)', () => {
      expect(RepoFullName.safeParse('payments-api').success).toBe(false);
    });
    it('rejects three-segment paths', () => {
      expect(RepoFullName.safeParse('a/b/c').success).toBe(false);
    });
  });

  describe('PrNumber', () => {
    it('accepts a positive integer', () => {
      expect(PrNumber.safeParse(482).success).toBe(true);
    });
    it('rejects zero, negatives, and non-integers', () => {
      expect(PrNumber.safeParse(0).success).toBe(false);
      expect(PrNumber.safeParse(-3).success).toBe(false);
      expect(PrNumber.safeParse(1.5).success).toBe(false);
    });
  });

  describe('Severity', () => {
    it('accepts the three canonical values, case-sensitively', () => {
      expect(Severity.safeParse('CRITICAL').success).toBe(true);
      expect(Severity.safeParse('WARNING').success).toBe(true);
      expect(Severity.safeParse('SUGGESTION').success).toBe(true);
      expect(Severity.safeParse('critical').success).toBe(false);
    });
  });

  describe('ListAgentsInput', () => {
    it('defaults enabled_only to false', () => {
      const parsed = ListAgentsInput.parse({});
      expect(parsed.enabled_only).toBe(false);
    });
  });

  describe('GetFindingsInput (run_id XOR repo+pr)', () => {
    it('accepts run_id alone', () => {
      expect(GetFindingsInput.safeParse({ run_id: 'r1' }).success).toBe(true);
    });
    it('accepts repo+pr together', () => {
      expect(GetFindingsInput.safeParse({ repo: 'acme/api', pr: 1 }).success).toBe(true);
    });
    it('rejects neither', () => {
      expect(GetFindingsInput.safeParse({}).success).toBe(false);
    });
    it('rejects both run_id and repo+pr', () => {
      expect(
        GetFindingsInput.safeParse({ run_id: 'r1', repo: 'acme/api', pr: 1 }).success,
      ).toBe(false);
    });
    it('rejects repo without pr', () => {
      expect(GetFindingsInput.safeParse({ repo: 'acme/api' }).success).toBe(false);
    });
  });
});
