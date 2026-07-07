/**
 * MCP-layer error mapping. Domain errors (`AppError` and its subclasses,
 * `server/src/platform/errors.ts`) become an actionable, machine-readable MCP
 * `CallToolResult`: `{ isError: true, structuredContent: { code, message,
 * retry }, content: [{ type: 'text', text }] }`. Unknown (non-`AppError`)
 * errors map to `INTERNAL_ERROR` WITHOUT leaking their raw message.
 *
 * `AppError` hierarchy (platform/errors.ts):
 *   AppError(code: string, message, statusCode = 400, details?)
 *     NotFoundError(message, details?)          → code 'not_found',            statusCode 404
 *     ValidationError(message, details?)        → code 'validation_error',     statusCode 422
 *     ExternalServiceError(message, details?)   → code 'external_service_error', statusCode 502
 *     ConfigError(message, details?)            → code 'config_error',         statusCode 500
 *
 * None of those generic `.code`s match this file's stable MCP code union, so
 * call sites that need a SPECIFIC MCP code (e.g. distinguishing a missing repo
 * from a missing PR) must throw via `notFoundError`/`mcpError` below — which
 * reuse `AppError` itself (no new error base) but set `AppError.code` directly
 * to one of the stable strings, e.g. `new AppError('REPO_NOT_FOUND', ...)`.
 * `toMcpError` then recognizes `err.code` as-is. `resolvers.ts` is the first
 * caller (normalizes `ReviewService.resolveRepo`/`resolvePull`'s generic
 * `NotFoundError`s this way); later handlers (`run-agent-on-pr.ts`,
 * `get-findings.ts`) do the same for `AGENT_NOT_FOUND` / `NO_ENABLED_AGENTS` /
 * `RUN_NOT_FOUND` / `VALIDATION_ERROR`.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AppError, ConfigError, ValidationError } from '../platform/errors.js';

/** Stable, machine-readable MCP error codes (fixed by the plan — do not add
 *  ad-hoc codes; anything else collapses to `INTERNAL_ERROR`). */
export type McpErrorCode =
  | 'REPO_NOT_FOUND'
  | 'PR_NOT_FOUND'
  | 'AGENT_NOT_FOUND'
  | 'NO_ENABLED_AGENTS'
  | 'RUN_NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'CONFIG_ERROR'
  | 'INTERNAL_ERROR';

const MCP_ERROR_CODES: ReadonlySet<string> = new Set<McpErrorCode>([
  'REPO_NOT_FOUND',
  'PR_NOT_FOUND',
  'AGENT_NOT_FOUND',
  'NO_ENABLED_AGENTS',
  'RUN_NOT_FOUND',
  'VALIDATION_ERROR',
  'CONFIG_ERROR',
  'INTERNAL_ERROR',
]);

function isMcpErrorCode(code: string): code is McpErrorCode {
  return MCP_ERROR_CODES.has(code);
}

/**
 * Codes for which retrying the SAME call is pointless (bad id / bad input /
 * missing config) vs `INTERNAL_ERROR`, which may be transient and is worth a
 * retry from the caller's side.
 */
const RETRYABLE: ReadonlySet<McpErrorCode> = new Set<McpErrorCode>(['INTERNAL_ERROR']);

/** The 4 not-found-flavored codes `notFoundError` is allowed to throw. */
export type McpNotFoundCode = 'REPO_NOT_FOUND' | 'PR_NOT_FOUND' | 'AGENT_NOT_FOUND' | 'RUN_NOT_FOUND';

/**
 * Throw a typed domain error tagged with a stable MCP code. Reuses the
 * project's `AppError` (does NOT invent a new error base) — sets
 * `AppError.code` to the MCP-stable string directly so `toMcpError` can read
 * it back without guessing from the message.
 */
export function mcpError(code: McpErrorCode, message: string, statusCode = 400, details?: unknown): never {
  throw new AppError(code, message, statusCode, details);
}

/** Convenience wrapper for the 4 not-found codes (statusCode fixed at 404). */
export function notFoundError(code: McpNotFoundCode, message: string, details?: unknown): never {
  mcpError(code, message, 404, details);
}

interface Classified {
  code: McpErrorCode;
  message: string;
  retry: boolean;
}

function classify(err: unknown): Classified {
  if (err instanceof AppError) {
    // Already tagged with a stable MCP code (via mcpError/notFoundError) —
    // use it and its message as-is (both are ours, safe to surface).
    if (isMcpErrorCode(err.code)) {
      return { code: err.code, message: err.message, retry: RETRYABLE.has(err.code) };
    }
    // Generic platform AppError subclasses map 1:1 regardless of message.
    if (err instanceof ValidationError) {
      return { code: 'VALIDATION_ERROR', message: err.message, retry: false };
    }
    if (err instanceof ConfigError) {
      return { code: 'CONFIG_ERROR', message: err.message, retry: false };
    }
    // Any other AppError (a generic NotFoundError not yet re-tagged by a
    // resolver/handler, ExternalServiceError, or a plain AppError) — its
    // message is still OUR curated text (not a raw exception), so it is safe
    // to surface, but we can't justify a more specific stable code here.
    return { code: 'INTERNAL_ERROR', message: err.message, retry: true };
  }
  // Unknown, non-AppError error — never leak the raw message.
  return {
    code: 'INTERNAL_ERROR',
    message: 'An unexpected internal error occurred.',
    retry: true,
  };
}

/** Map any thrown error to a `CallToolResult` with `isError: true`. */
export function toMcpError(err: unknown): CallToolResult {
  const { code, message, retry } = classify(err);
  return {
    isError: true,
    structuredContent: { code, message, retry },
    content: [{ type: 'text', text: `Error [${code}]: ${message}` }],
  };
}
