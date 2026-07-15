import type { Container } from '../../platform/container.js';
import type { EvalExpectation, Finding, Provider } from '@devdigest/shared';
import { EvalExpectation as EvalExpectationSchema } from '@devdigest/shared';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import type { AgentRow, EvalCaseRow, EvalRunRow } from '../../db/rows.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { REVIEW_STRATEGY } from '../reviews/constants.js';
import {
  computeCasePass,
  computeCitationAccuracy,
  computePrecision,
  computeRecall,
  type CaseScoringInput,
  type GroundingTotals,
} from './scoring.js';
import { generateBatchId, EVAL_CASE_TASK } from './constants.js';
import type { EvalRunActualOutput } from './helpers.js';

/**
 * SPEC-05 Recommendation 4 — `runBatch`: the case-execution orchestrator.
 *
 * `ReviewService.reviewDiff` (D5's reuse point for the ENGINE CALL SHAPE) loops
 * over AGENTS for one raw diff. This loops over CASES for one fixed agent — the
 * other axis. Each case gets its own `reviewPullRequest` call (repo-intel OFF,
 * same as `reviewDiff`'s working-tree baseline — AC-6) against its FROZEN
 * `input_diff`, isolated by a per-case try/catch (AC-22) so one bad case (LLM
 * error/timeout/malformed frozen diff/malformed `expected_output`) never
 * aborts the rest of the batch.
 *
 * After every case has executed (or failed), the batch aggregate
 * (`recall`/`precision`/`citation_accuracy`) is computed ONCE from the
 * successfully-scored cases (D3) and stamped IDENTICALLY across every
 * `eval_runs` row this batch writes — including the failed ones, so a
 * "recent runs" query grouped by `batch_id` always sees one consistent
 * summary regardless of which row it reads.
 */

interface CaseOutcome {
  case: EvalCaseRow;
  expectation: EvalExpectation | null;
  producedFindings: Finding[];
  groundingTotals: GroundingTotals;
  durationMs: number;
  costUsd: number | null;
  error?: string;
}

export async function runBatch(
  container: Container,
  agent: AgentRow,
  cases: EvalCaseRow[],
): Promise<EvalRunRow[]> {
  const batchId = generateBatchId();
  const repo = container.evalRepo;

  const linked = await container.agentsRepo.linkedSkills(agent.id);
  const skills = linked.filter((l) => l.skill.enabled).map((l) => l.skill.body);
  const llm = await container.llm(agent.provider as Provider);

  const outcomes: CaseOutcome[] = [];
  for (const c of cases) {
    const startedAt = Date.now();
    try {
      // Frozen diff + expectation are re-validated per case — either can be
      // hand-edited into an invalid shape by the case editor; a malformed one
      // throws here and is isolated below, never aborting the other cases.
      const expectation = EvalExpectationSchema.parse(c.expectedOutput);
      const diff = parseUnifiedDiff(c.inputDiff ?? '');

      const outcome = await reviewPullRequest({
        systemPrompt: agent.systemPrompt,
        model: agent.model,
        diff,
        llm,
        strategy: agent.strategy ?? REVIEW_STRATEGY,
        ...(skills.length > 0 ? { skills } : {}),
        task: EVAL_CASE_TASK,
        sessionId: `eval-batch:${batchId}`,
      });

      outcomes.push({
        case: c,
        expectation,
        producedFindings: outcome.review.findings,
        groundingTotals: {
          kept: outcome.review.findings.length,
          dropped: outcome.dropped.length,
        },
        durationMs: Date.now() - startedAt,
        costUsd: outcome.costUsd,
      });
    } catch (err) {
      outcomes.push({
        case: c,
        expectation: null,
        producedFindings: [],
        groundingTotals: { kept: 0, dropped: 0 },
        durationMs: Date.now() - startedAt,
        costUsd: null,
        error: (err as Error).message,
      });
    }
  }

  // Batch aggregate — computed once from the executions that scored cleanly.
  const scoringInputs: CaseScoringInput[] = outcomes
    .filter((o): o is CaseOutcome & { expectation: EvalExpectation } => o.expectation !== null)
    .map((o) => ({ expectation: o.expectation, producedFindings: o.producedFindings }));
  const recall = computeRecall(scoringInputs);
  const precision = computePrecision(scoringInputs);
  const citationAccuracy = computeCitationAccuracy(
    outcomes.filter((o) => o.expectation !== null).map((o) => o.groundingTotals),
  );

  const rows: EvalRunRow[] = [];
  for (const o of outcomes) {
    // AC-22: a failed case (expectation === null) records pass=null — a
    // failure marker distinct from both true (matched) and false (no match).
    const pass = o.expectation
      ? computeCasePass({ expectation: o.expectation, producedFindings: o.producedFindings })
      : null;

    const actualOutput: EvalRunActualOutput = {
      produced_findings: o.producedFindings,
      grounding: o.groundingTotals,
      meta: {
        batch_id: batchId,
        agent_id: agent.id,
        agent_version: agent.version,
        provider: agent.provider,
        model: agent.model,
      },
      ...(o.error ? { error: o.error } : {}),
    };

    const row = await repo.insertRun({
      caseId: o.case.id,
      actualOutput,
      pass,
      recall,
      precision,
      citationAccuracy,
      durationMs: o.durationMs,
      costUsd: o.costUsd,
    });
    rows.push(row);
  }
  return rows;
}
