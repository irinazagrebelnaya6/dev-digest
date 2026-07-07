import { describe, it, expect } from 'vitest';
import { toMcpError, mcpError, notFoundError } from '../../src/mcp/errors.js';
import { AppError, ValidationError, ConfigError, NotFoundError } from '../../src/platform/errors.js';

function structured(result: ReturnType<typeof toMcpError>) {
  return result.structuredContent as { code: string; message: string; retry: boolean };
}

describe('toMcpError', () => {
  it('passes through a stable MCP code set via mcpError/notFoundError', () => {
    const r = toMcpError(new AppError('REPO_NOT_FOUND', 'no repo', 404));
    expect(r.isError).toBe(true);
    const s = structured(r);
    expect(s.code).toBe('REPO_NOT_FOUND');
    expect(s.message).toBe('no repo');
    expect(s.retry).toBe(false);
    expect(r.content[0]).toMatchObject({ type: 'text' });
  });

  it('maps ValidationError → VALIDATION_ERROR (not retryable)', () => {
    const s = structured(toMcpError(new ValidationError('bad input')));
    expect(s.code).toBe('VALIDATION_ERROR');
    expect(s.retry).toBe(false);
  });

  it('maps ConfigError → CONFIG_ERROR (not retryable)', () => {
    const s = structured(toMcpError(new ConfigError('missing key')));
    expect(s.code).toBe('CONFIG_ERROR');
    expect(s.retry).toBe(false);
  });

  it('maps a generic NotFoundError (code "not_found") → INTERNAL_ERROR but keeps our message', () => {
    const s = structured(toMcpError(new NotFoundError('Pull request not found')));
    expect(s.code).toBe('INTERNAL_ERROR');
    expect(s.message).toBe('Pull request not found');
    expect(s.retry).toBe(true);
  });

  it('never leaks an unknown (non-AppError) error message', () => {
    const s = structured(toMcpError(new Error('secret internal detail')));
    expect(s.code).toBe('INTERNAL_ERROR');
    expect(s.message).not.toContain('secret');
    expect(s.retry).toBe(true);
  });
});

describe('mcpError / notFoundError', () => {
  it('mcpError throws an AppError tagged with the stable code', () => {
    expect(() => mcpError('NO_ENABLED_AGENTS', 'none', 400)).toThrowError(AppError);
    try {
      mcpError('NO_ENABLED_AGENTS', 'none', 400);
    } catch (e) {
      expect((e as AppError).code).toBe('NO_ENABLED_AGENTS');
    }
  });

  it('notFoundError throws a 404 AppError with the not-found code', () => {
    try {
      notFoundError('RUN_NOT_FOUND', 'gone');
    } catch (e) {
      expect((e as AppError).code).toBe('RUN_NOT_FOUND');
      expect((e as AppError).statusCode).toBe(404);
    }
  });
});
