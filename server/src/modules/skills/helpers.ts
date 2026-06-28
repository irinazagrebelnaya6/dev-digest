import type { Skill, SkillSource, SkillType } from '@devdigest/shared';
import type { SkillRow } from '../../db/rows.js';
import type { UpdateSkillInput } from './service.js';

/** Map a persisted skill row to the public `Skill` DTO. */
export function toSkillDto(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as SkillType,
    source: row.source as SkillSource,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: (row.evidenceFiles as string[] | null) ?? null,
  };
}

/** True when a patch should bump the skill's version (only `body` changes are versioned). */
export function isBodyChange(patch: UpdateSkillInput): boolean {
  return patch.body !== undefined;
}
