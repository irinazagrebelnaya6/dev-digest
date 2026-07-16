import { describe, it, expect } from 'vitest';
import { deriveMultiAgentStatus } from '../src/modules/multi-agent/status.js';
import { composeLocationGroups, essenceSimilarity } from '../src/modules/multi-agent/grouping.js';
import type { GroupableFinding } from '../src/modules/multi-agent/grouping.js';
import {
  estimateAgent,
  medianComparableTokens,
  summarizeEstimates,
} from '../src/modules/multi-agent/estimate.js';
import { computeEconomics } from '../src/modules/multi-agent/economics.js';

/**
 * SPEC-06 [API] pure composer unit tests — DB-free, no LLM. Covers AC-6, AC-7,
 * AC-12, AC-19, AC-20, AC-21.
 */

describe('deriveMultiAgentStatus (AC-12)', () => {
  it('is running while any child is still running', () => {
    expect(deriveMultiAgentStatus(['done', 'running', 'failed'])).toBe('running');
    expect(deriveMultiAgentStatus(['done', null])).toBe('running');
  });

  it('is done when every child is done', () => {
    expect(deriveMultiAgentStatus(['done', 'done'])).toBe('done');
  });

  it('is failed when every child failed', () => {
    expect(deriveMultiAgentStatus(['failed', 'failed'])).toBe('failed');
  });

  it('is partial when all settled with >=1 failure', () => {
    expect(deriveMultiAgentStatus(['done', 'failed', 'done'])).toBe('partial');
    expect(deriveMultiAgentStatus(['done', 'cancelled'])).toBe('partial');
  });
});

function finding(over: Partial<GroupableFinding>): GroupableFinding {
  return {
    id: 'f1',
    agent_id: 'a1',
    file: 'src/config.ts',
    start_line: 10,
    end_line: 12,
    severity: 'CRITICAL',
    title: 'Hardcoded secret key',
    rationale: 'A live secret key is committed in source.',
    ...over,
  };
}

describe('composeLocationGroups (AC-19, AC-20, AC-21)', () => {
  const agents = [
    { id: 'a1', name: 'Security Reviewer' },
    { id: 'a2', name: 'Perf Reviewer' },
    { id: 'a3', name: 'Style Reviewer' },
  ];

  it('same-location findings from different agents intersect into ONE group', () => {
    const groups = composeLocationGroups(
      [
        { agent_id: 'a1', agent_name: 'Security Reviewer', findings: [finding({ id: 'f1', agent_id: 'a1' })] },
        {
          agent_id: 'a2',
          agent_name: 'Perf Reviewer',
          findings: [
            finding({
              id: 'f2',
              agent_id: 'a2',
              title: 'Hardcoded secret',
              rationale: 'A secret key is committed directly in source code.',
            }),
          ],
        },
      ],
      agents.slice(0, 2),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.takes).toHaveLength(2);
  });

  it('distinguishes "did not flag" (ignored) from "did not run" (did_not_run)', () => {
    const groups = composeLocationGroups(
      [
        { agent_id: 'a1', agent_name: 'Security Reviewer', findings: [finding({ id: 'f1', agent_id: 'a1' })] },
        { agent_id: 'a2', agent_name: 'Perf Reviewer', findings: [] },
      ],
      agents, // a3 is NOT part of this run
    );
    expect(groups).toHaveLength(1);
    const takes = groups[0]!.takes;
    expect(takes.find((t) => t.agent_id === 'a1')!.verdict).toBe('CRITICAL');
    expect(takes.find((t) => t.agent_id === 'a2')!.verdict).toBe('ignored');
    expect(takes.find((t) => t.agent_id === 'a3')!.verdict).toBe('did_not_run');
  });

  it('is a conflict when >=1 flagged AND >=1 in-run agent did not flag', () => {
    const groups = composeLocationGroups(
      [
        { agent_id: 'a1', agent_name: 'Security Reviewer', findings: [finding({ id: 'f1', agent_id: 'a1' })] },
        { agent_id: 'a2', agent_name: 'Perf Reviewer', findings: [] },
      ],
      agents.slice(0, 2),
    );
    expect(groups[0]!.is_conflict).toBe(true);
  });

  it('is a conflict when flagging agents disagree on severity', () => {
    const groups = composeLocationGroups(
      [
        { agent_id: 'a1', agent_name: 'Security Reviewer', findings: [finding({ id: 'f1', agent_id: 'a1', severity: 'CRITICAL' })] },
        {
          agent_id: 'a2',
          agent_name: 'Perf Reviewer',
          findings: [
            finding({
              id: 'f2',
              agent_id: 'a2',
              severity: 'WARNING',
              title: 'Hardcoded secret',
              rationale: 'A secret key is committed directly in source code.',
            }),
          ],
        },
      ],
      agents.slice(0, 2),
    );
    expect(groups[0]!.is_conflict).toBe(true);
  });

  it('is NOT a conflict when every in-run agent that flagged agrees, and no in-run agent ignored it', () => {
    const groups = composeLocationGroups(
      [{ agent_id: 'a1', agent_name: 'Security Reviewer', findings: [finding({ id: 'f1', agent_id: 'a1' })] }],
      agents.slice(0, 1),
    );
    expect(groups[0]!.is_conflict).toBe(false);
  });

  it('does not merge unrelated findings that happen to overlap in range (low essence similarity)', () => {
    const groups = composeLocationGroups(
      [
        { agent_id: 'a1', agent_name: 'Security Reviewer', findings: [finding({ id: 'f1', agent_id: 'a1' })] },
        {
          agent_id: 'a2',
          agent_name: 'Perf Reviewer',
          findings: [
            finding({
              id: 'f2',
              agent_id: 'a2',
              severity: 'SUGGESTION',
              title: 'Inefficient loop allocation',
              rationale: 'This loop allocates a new array every iteration, wasting memory.',
            }),
          ],
        },
      ],
      agents.slice(0, 2),
    );
    expect(groups).toHaveLength(2);
  });

  it('essenceSimilarity is 0 for completely unrelated text', () => {
    expect(essenceSimilarity({ title: 'abc' }, { title: 'xyz' })).toBe(0);
  });
});

describe('estimateAgent + summarizeEstimates (AC-5, AC-6, AC-7)', () => {
  const priceEstimate = (model: string, tokensIn: number, tokensOut: number) =>
    model === 'no-price' ? null : (tokensIn + tokensOut) * 0.00001;

  it('is "exact" when the agent has prior completed runs (averaged)', () => {
    const est = estimateAgent(
      {
        agent_id: 'a1',
        agent_name: 'Sec',
        model: 'gpt-4.1',
        priorRuns: [
          { durationMs: 1000, tokensIn: 1000, tokensOut: 200 },
          { durationMs: 2000, tokensIn: 3000, tokensOut: 600 },
        ],
      },
      priceEstimate,
      null,
    );
    expect(est.confidence).toBe('exact');
    expect(est.est_time_ms).toBe(1500);
    expect(est.est_cost_usd).not.toBeNull();
  });

  it('is "approx" (fallback marker) when no history but comparable runs exist', () => {
    const est = estimateAgent(
      { agent_id: 'a2', agent_name: 'New Agent', model: 'gpt-4.1', priorRuns: [] },
      priceEstimate,
      { tokensIn: 1000, tokensOut: 200 },
    );
    expect(est.confidence).toBe('approx');
    expect(est.est_time_ms).toBeNull();
    expect(est.est_cost_usd).not.toBeNull();
  });

  it('is "none" (no fabricated number) when no history AND no comparables', () => {
    const est = estimateAgent(
      { agent_id: 'a3', agent_name: 'Brand New', model: 'gpt-4.1', priorRuns: [] },
      priceEstimate,
      null,
    );
    expect(est.confidence).toBe('none');
    expect(est.est_time_ms).toBeNull();
    expect(est.est_cost_usd).toBeNull();
  });

  it('summary = MAX(time) and SUM(cost) over the selected set', () => {
    const summary = summarizeEstimates([
      { agent_id: 'a1', agent_name: 'A', est_time_ms: 1000, est_cost_usd: 0.01, confidence: 'exact' },
      { agent_id: 'a2', agent_name: 'B', est_time_ms: 3000, est_cost_usd: 0.02, confidence: 'exact' },
    ]);
    expect(summary.summary_time_ms).toBe(3000);
    expect(summary.summary_cost_usd).toBeCloseTo(0.03);
  });

  it('medianComparableTokens is null when no comparable runs exist', () => {
    expect(medianComparableTokens([])).toBeNull();
    expect(medianComparableTokens([{ tokensIn: null, tokensOut: null }])).toBeNull();
  });
});

describe('computeEconomics (AC-22)', () => {
  it('multi totals sum every compared run; single is the one baseline run', () => {
    const priceEstimate = (_model: string, tokensIn: number, tokensOut: number) =>
      (tokensIn + tokensOut) * 0.00001;
    const result = computeEconomics(
      { model: 'gpt-4.1', tokensIn: 1000, tokensOut: 200 },
      [
        { model: 'gpt-4.1', tokensIn: 1000, tokensOut: 200 },
        { model: 'gpt-4.1', tokensIn: 2000, tokensOut: 400 },
      ],
      priceEstimate,
    );
    expect(result.single.tokens_in).toBe(1000);
    expect(result.multi.tokens_in).toBe(3000);
    expect(result.multi.cost_usd).toBeCloseTo(result.single.cost_usd + priceEstimate('gpt-4.1', 2000, 400));
  });
});
