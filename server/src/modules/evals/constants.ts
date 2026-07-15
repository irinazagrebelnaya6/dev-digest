import { randomUUID } from 'node:crypto';

/**
 * Rate limit for the three batch-triggering routes (`POST /agents/:id/eval-runs`,
 * `POST /eval-cases/:id/eval-runs`, `POST /eval-dashboard/run-all`) — Q6's
 * adopted default: tighter than the existing `/pulls/:id/review` 10/min
 * pattern, since a batch fans out to N LLM calls per click rather than one.
 */
export const EVAL_RUN_RATE_LIMIT = { max: 3, timeWindow: '1 minute' } as const;

/** New identifier for a "run all cases"/"run all agents" batch (D2). */
export function generateBatchId(): string {
  return randomUUID();
}

/** Task framing line for a frozen-case execution (distinct from a live-PR review's task line). */
export const EVAL_CASE_TASK =
  'Review this frozen diff fragment exactly as you would a real PR change.';
