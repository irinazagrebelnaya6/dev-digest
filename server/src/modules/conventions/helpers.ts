import type { ConventionCandidate } from '@devdigest/shared';
import type { ConventionRow } from './repository.js';

/**
 * Render accepted candidates into a markdown skill body grouped by category.
 * Each entry includes the evidence file:line reference.
 */
export function renderSkillBody(candidates: ConventionCandidate[]): string {
  if (candidates.length === 0) return '# repo-conventions\n\nNo conventions accepted yet.';

  // Group by category
  const groups = new Map<string, ConventionCandidate[]>();
  for (const c of candidates) {
    const cat = c.category ?? 'General';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(c);
  }

  const lines: string[] = ['# repo-conventions', ''];
  for (const [category, items] of groups) {
    lines.push(`## ${category}`, '');
    for (const c of items) {
      const evidence = c.evidence_path
        ? `  (evidence: \`${c.evidence_path}${c.evidence_line ? `:${c.evidence_line}` : ''}\`)`
        : '';
      lines.push(`- ${c.rule}${evidence}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

export function toConventionDto(row: ConventionRow): ConventionCandidate {
  return {
    id: row.id,
    category: row.category,
    rule: row.rule,
    evidence_path: row.evidencePath,
    evidence_snippet: row.evidenceSnippet,
    evidence_line: row.evidenceLine,
    confidence: row.confidence,
    status: row.status as ConventionCandidate['status'],
    extraction_run_id: row.extractionRunId,
  };
}
