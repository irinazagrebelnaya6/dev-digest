import type { EvalCase, EvalOwnerKind, EvalRunRecord } from '@devdigest/shared';
import type { EvalCaseRow, EvalRunRow, RunWithCase } from './repository.js';

/**
 * Pure helpers for the evals module — DB row <-> DTO mapping (D1's already-
 * scaffolded `EvalCase`/`EvalRunRecord` contracts) and the batch-grouping read
 * helper (D2: a "run" as the UI presents it = every `eval_runs` row sharing one
 * `actual_output.meta.batch_id`).
 */

export function toEvalCaseDto(row: EvalCaseRow): EvalCase {
  return {
    id: row.id,
    owner_kind: row.ownerKind as EvalOwnerKind,
    owner_id: row.ownerId,
    name: row.name,
    input_diff: row.inputDiff ?? '',
    input_files: row.inputFiles ?? null,
    input_meta: row.inputMeta ?? null,
    expected_output: row.expectedOutput ?? null,
    notes: row.notes,
  };
}

export function toEvalRunRecordDto({ run, case: caseRow }: RunWithCase): EvalRunRecord {
  return {
    id: run.id,
    case_id: run.caseId,
    case_name: caseRow.name,
    ran_at: run.ranAt.toISOString(),
    actual_output: run.actualOutput,
    pass: run.pass,
    recall: run.recall,
    precision: run.precision,
    citation_accuracy: run.citationAccuracy,
    duration_ms: run.durationMs,
    cost_usd: run.costUsd,
  };
}

/**
 * The `actual_output.meta` sub-shape (D2) — nested inside the existing jsonb
 * `actual_output` column, NOT a new DB column or shared Zod export (D2/D3's
 * "no contract shape changes needed there beyond documenting the
 * `actual_output.meta` sub-shape"). Server-internal only.
 */
export interface EvalRunMeta {
  batch_id: string;
  agent_id: string;
  agent_version: number;
  provider: string;
  model: string;
}

export interface EvalRunActualOutput {
  produced_findings: unknown[];
  grounding: { kept: number; dropped: number };
  meta: EvalRunMeta;
  error?: string;
}

function parseMeta(actualOutput: unknown): EvalRunMeta | null {
  if (!actualOutput || typeof actualOutput !== 'object') return null;
  const meta = (actualOutput as Record<string, unknown>).meta;
  if (!meta || typeof meta !== 'object') return null;
  const m = meta as Record<string, unknown>;
  if (
    typeof m.batch_id !== 'string' ||
    typeof m.agent_id !== 'string' ||
    typeof m.agent_version !== 'number' ||
    typeof m.provider !== 'string' ||
    typeof m.model !== 'string'
  ) {
    return null;
  }
  return m as unknown as EvalRunMeta;
}

/** A "run" as the UI presents it — all `eval_runs` rows sharing one `meta.batch_id`. */
export interface EvalBatch {
  batch_id: string;
  agent_id: string;
  agent_version: number;
  /** Timestamp of the batch's earliest case execution. */
  ran_at: string;
  /** Stamped identically across every row in the batch (D3). */
  recall: number | null;
  precision: number | null;
  citation_accuracy: number | null;
  cases_total: number;
  traces_passed: number;
  traces_total: number;
  /** Summed per-case (D3: duration_ms/cost_usd stay per-case, natural at case_id grain). */
  duration_ms: number | null;
  cost_usd: number | null;
  runs: EvalRunRecord[];
}

/**
 * Group a flat list of run+case rows into batches by `actual_output.meta.batch_id`,
 * newest batch first. Rows whose `actual_output` lacks well-formed `meta` (e.g.
 * legacy/manual rows never produced by `runBatch`) are skipped — they carry no
 * batch identity to group by.
 */
export function groupRunsByBatch(rows: RunWithCase[]): EvalBatch[] {
  const groups = new Map<string, RunWithCase[]>();
  for (const row of rows) {
    const meta = parseMeta(row.run.actualOutput);
    if (!meta) continue;
    const arr = groups.get(meta.batch_id) ?? [];
    arr.push(row);
    groups.set(meta.batch_id, arr);
  }

  const batches: EvalBatch[] = [];
  for (const [batchId, groupRows] of groups) {
    const meta = parseMeta(groupRows[0]!.run.actualOutput)!;
    const sorted = [...groupRows].sort((a, b) => a.run.ranAt.getTime() - b.run.ranAt.getTime());
    const earliest = sorted[0]!.run;
    const durationTotal = groupRows.reduce((sum, r) => sum + (r.run.durationMs ?? 0), 0);
    const costTotal = groupRows.every((r) => r.run.costUsd == null)
      ? null
      : groupRows.reduce((sum, r) => sum + (r.run.costUsd ?? 0), 0);

    batches.push({
      batch_id: batchId,
      agent_id: meta.agent_id,
      agent_version: meta.agent_version,
      ran_at: earliest.ranAt.toISOString(),
      recall: groupRows[0]!.run.recall,
      precision: groupRows[0]!.run.precision,
      citation_accuracy: groupRows[0]!.run.citationAccuracy,
      cases_total: groupRows.length,
      traces_passed: groupRows.filter((r) => r.run.pass === true).length,
      traces_total: groupRows.length,
      duration_ms: durationTotal,
      cost_usd: costTotal,
      runs: groupRows.map(toEvalRunRecordDto),
    });
  }

  batches.sort((a, b) => new Date(b.ran_at).getTime() - new Date(a.ran_at).getTime());
  return batches;
}

/** Read a run row's `meta` (typed, null-safe) — used by compare/promote. */
export function metaOf(run: EvalRunRow): EvalRunMeta | null {
  return parseMeta(run.actualOutput);
}
