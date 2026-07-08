import type { Onboarding, OnboardingLink, OnboardingSection } from '@devdigest/shared';
import type { OnboardingFacts } from '@devdigest/reviewer-core';
import { MAX_SECTION_LINKS, ONBOARDING_SECTION_ORDER, type OnboardingSectionKind } from './constants.js';

/**
 * Pure `facts -> Onboarding` skeleton (SPEC-03, AC-5). This is the
 * deterministic, no-prose fallback rendered when the index is degraded OR the
 * single narration call fails — it must NEVER be empty and every claim it
 * makes must trace to a fact (never invented, AC-6/AC-8/AC-15). It is also the
 * grounding backstop for `ground.ts` when the model's output for a section is
 * missing/unusable.
 */
export function buildSkeleton(facts: OnboardingFacts): Onboarding {
  const sections: OnboardingSection[] = ONBOARDING_SECTION_ORDER.map(({ kind, title }) => ({
    kind,
    title,
    diagram: null,
    ...sectionBody(kind, facts),
  }));
  return { sections };
}

function sectionBody(
  kind: OnboardingSectionKind,
  facts: OnboardingFacts,
): { body: string; links: OnboardingLink[] } {
  switch (kind) {
    case 'architecture':
      return { body: architectureBody(facts), links: architectureLinks(facts) };
    case 'critical_paths':
      return { body: criticalPathsBody(facts), links: criticalPathsLinks(facts) };
    case 'run_local':
      return { body: runLocalBody(facts), links: [] };
    case 'reading_path':
      return { body: readingPathBody(facts), links: readingPathLinks(facts) };
    case 'first_tasks':
      return { body: firstTasksBody(facts), links: firstTasksLinks(facts) };
  }
}

function architectureBody(facts: OnboardingFacts): string {
  const lines = [`**Stack:** ${facts.stack || 'Not determined from the index.'}`];
  if (facts.endpoints.length > 0) {
    lines.push('', '**Reachable HTTP endpoints (from the index):**');
    for (const e of facts.endpoints.slice(0, 10)) lines.push(`- ${e.method.toUpperCase()} ${e.path}`);
  }
  if (facts.rankedFiles.length > 0) {
    lines.push('', `Most central file: \`${facts.rankedFiles[0]!.path}\`.`);
  }
  return lines.join('\n');
}

function architectureLinks(facts: OnboardingFacts): OnboardingLink[] {
  return facts.rankedFiles.slice(0, MAX_SECTION_LINKS).map((f) => ({ label: f.path, path: f.path }));
}

function criticalPathsBody(facts: OnboardingFacts): string {
  if (facts.criticalPaths.length === 0) return 'No critical paths were detected in the index yet.';
  return facts.criticalPaths.map((c) => `- \`${c.path}\` — ${c.reason}`).join('\n');
}

function criticalPathsLinks(facts: OnboardingFacts): OnboardingLink[] {
  return facts.criticalPaths.slice(0, MAX_SECTION_LINKS).map((c) => ({ label: c.path, path: c.path }));
}

/** Numbered, copyable steps built ONLY from facts — never an invented command (AC-8). */
function runLocalBody(facts: OnboardingFacts): string {
  const steps: string[] = [];
  if (facts.hasEnvExample) steps.push('Copy `.env.example` to `.env` and fill in the required values.');
  if (facts.packageJson) {
    steps.push('Install dependencies: `npm install`');
    const scripts = facts.packageJson.scripts ?? {};
    for (const key of ['dev', 'start', 'build', 'test']) {
      const cmd = scripts[key];
      if (cmd) steps.push(`Run \`npm run ${key}\` (\`${cmd}\`)`);
    }
  }
  if (facts.composeFile) {
    steps.push(`Start dependent services: \`docker compose -f ${facts.composeFile} up\``);
  }
  if (steps.length === 0) {
    return 'No run-local steps could be derived from the index yet — inspect the repo root manually.';
  }
  return steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
}

function readingPathBody(facts: OnboardingFacts): string {
  if (facts.rankedFiles.length === 0) return 'No ranked files were found in the index yet.';
  return facts.rankedFiles.map((f, i) => `${i + 1}. \`${f.path}\``).join('\n');
}

function readingPathLinks(facts: OnboardingFacts): OnboardingLink[] {
  return facts.rankedFiles.slice(0, MAX_SECTION_LINKS).map((f) => ({ label: f.path, path: f.path }));
}

/** Prefers critical paths (highest-signal); falls back to the top ranked files. */
function firstTaskPaths(facts: OnboardingFacts): string[] {
  const fromCritical = facts.criticalPaths.slice(0, 3).map((c) => c.path);
  if (fromCritical.length > 0) return fromCritical;
  return facts.rankedFiles.slice(0, 3).map((f) => f.path);
}

function firstTasksBody(facts: OnboardingFacts): string {
  const candidates = firstTaskPaths(facts);
  if (candidates.length === 0) return 'No first tasks could be derived from the index yet.';
  return candidates
    .map((path, i) => `${i + 1}. Read through \`${path}\` and summarize what it does in a comment or PR description.`)
    .join('\n');
}

function firstTasksLinks(facts: OnboardingFacts): OnboardingLink[] {
  return firstTaskPaths(facts).map((path) => ({ label: path, path }));
}
