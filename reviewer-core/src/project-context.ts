/**
 * Project Context Folder (SPEC-01, Feature 1) — pure order/dedup helper.
 *
 * Resolved docs = agent-direct paths (in stored order) followed by
 * skill-inherited paths (in stored order), deduped by normalized repo-relative
 * path with first occurrence winning across the combined list. Purely a
 * string-ordering computation: no filesystem, DB, or network access — the
 * actual read + traversal-guard lives in `server/src/modules/project-context/`.
 */

/**
 * Normalize a repo-relative path string for dedup comparison only. Does not
 * resolve `..`/`.` segments (path traversal is rejected upstream, at the
 * write boundary and again by the server's run-time resolver) — it only
 * collapses cosmetic differences (backslashes, duplicate slashes, a leading
 * `./`, a trailing slash) so that e.g. `docs/a.md` and `./docs//a.md` dedup
 * to the same entry.
 */
function normalizeForDedup(path: string): string {
  let p = path.trim().replace(/\\/g, '/');
  p = p.replace(/\/+/g, '/');
  while (p.startsWith('./')) p = p.slice(2);
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

/**
 * Order + dedup attached context-doc paths for a run.
 *
 * @param direct - Paths attached directly to the agent, in stored order.
 * @param inherited - Paths inherited from the agent's linked skills, in
 *   stored order.
 * @returns Direct paths first, then inherited paths, deduped by normalized
 *   path (first occurrence — by combined direct-then-inherited order — wins).
 *   Intra-group order is preserved.
 */
export function orderContextSpecs(direct: string[], inherited: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const path of [...direct, ...inherited]) {
    const key = normalizeForDedup(path);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(path);
  }

  return result;
}
