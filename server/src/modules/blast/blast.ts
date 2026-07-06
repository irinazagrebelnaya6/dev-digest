import type { BlastRadius, DownstreamImpact } from '@devdigest/shared';
import type { BlastResult } from '../repo-intel/types.js';

/**
 * Blast Radius composer (L04). PURE — no LLM, no DB, no network. It only
 * reshapes an already-read `BlastResult` (from `repoIntel.getBlastRadius`) plus
 * the pre-computed 2-level reachable endpoints into the `BlastRadius` transport
 * contract: changed symbols → per-symbol callers → affected endpoints.
 *
 * The single analysis source is the repo-intel index; this file never parses
 * code. Mirrors the contract of `reviews/smart-diff.ts` (token-free composer).
 */

/** Max callers surfaced per changed symbol (matches repo-intel's own cap). */
export const MAX_CALLERS_PER_SYMBOL = 20;

export function composeBlastRadius(
  result: BlastResult,
  reachableEndpoints: string[],
  summary = '',
): BlastRadius {
  const changed_symbols = result.changedSymbols.map((s) => ({
    name: s.name,
    file: s.file,
    kind: s.kind,
  }));

  // Group callers by the changed symbol they reach (`viaSymbol`), preserving
  // the rank-sorted order the facade already produced.
  const bySymbol = new Map<string, BlastResult['callers']>();
  for (const c of result.callers) {
    getGroup(bySymbol, c.viaSymbol).push(c);
  }

  const downstream: DownstreamImpact[] = [];
  for (const [symbol, callers] of bySymbol) {
    const capped = callers.slice(0, MAX_CALLERS_PER_SYMBOL);
    // Endpoints/crons declared in the caller files of THIS symbol (direct hit).
    const endpoints = new Set<string>();
    const crons = new Set<string>();
    for (const c of capped) {
      const facts = result.factsByFile?.[c.file];
      if (!facts) continue;
      for (const e of facts.endpoints) endpoints.add(e);
      for (const cr of facts.crons) crons.add(cr);
    }
    downstream.push({
      symbol,
      callers: capped.map((c) => ({ name: c.symbol, file: c.file, line: c.line })),
      endpoints_affected: [...endpoints].sort(),
      crons_affected: [...crons].sort(),
    });
  }

  return {
    changed_symbols,
    downstream,
    reachable_endpoints: [...new Set(reachableEndpoints)].sort(),
    summary,
    degraded: result.degraded ?? false,
    reason: result.reason ?? null,
  };
}

/** Get-or-create the caller array for a symbol key (keeps insertion order). */
function getGroup(
  map: Map<string, BlastResult['callers']>,
  key: string,
): BlastResult['callers'] {
  let arr = map.get(key);
  if (!arr) {
    arr = [];
    map.set(key, arr);
  }
  return arr;
}
