/**
 * Onboarding module — pure literals, no imports (mirrors
 * `reviews/smart-diff.constants.ts`).
 */

export type OnboardingSectionKind =
  | 'architecture'
  | 'critical_paths'
  | 'run_local'
  | 'reading_path'
  | 'first_tasks';

interface OnboardingSectionMeta {
  kind: OnboardingSectionKind;
  title: string;
}

/** The 5 canonical sections, in the exact order the contract requires (AC-1). */
export const ONBOARDING_SECTION_ORDER: OnboardingSectionMeta[] = [
  { kind: 'architecture', title: 'Architecture' },
  { kind: 'critical_paths', title: 'Critical paths' },
  { kind: 'run_local', title: 'How to run locally' },
  { kind: 'reading_path', title: 'Guided reading path' },
  { kind: 'first_tasks', title: 'First tasks' },
];

/** How many top-ranked files feed `rankedFiles`/`reading_path` (AC-4). */
export const READING_PATH_SIZE = 15;

/** Cap on critical-path fact rows surfaced to the prompt/skeleton (bounded). */
export const MAX_CRITICAL_PATH_FACTS = 10;

/** Max links rendered per section (skeleton + grounded output). */
export const MAX_SECTION_LINKS = 4;

/**
 * Bounded root-file reads the analyzer performs (D3). These are the ONLY
 * clone reads it ever issues — never a source-file body (AC-6).
 */
export const PACKAGE_JSON_PATH = 'package.json';
export const COMPOSE_FILE_CANDIDATES = [
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
];
export const ENV_EXAMPLE_PATH = '.env.example';
