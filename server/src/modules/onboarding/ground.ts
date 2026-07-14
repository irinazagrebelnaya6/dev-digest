import { OnboardingDiagram, type Onboarding, type OnboardingLink, type OnboardingSection } from '@devdigest/shared';
import type { OnboardingFacts } from '@devdigest/reviewer-core';
import { buildSkeleton } from './skeleton.js';
import { MAX_SECTION_LINKS, ONBOARDING_SECTION_ORDER } from './constants.js';

/**
 * Grounds a generated `Onboarding` against the facts it should have been built
 * from (SPEC-03, AC-1/AC-7/AC-8/AC-13/AC-15). Pure — no LLM/DB/network.
 *
 *  - Forces the canonical 5-section order, filling any missing section from
 *    the deterministic skeleton (AC-1).
 *  - `run_local` and `reading_path` are ALWAYS replaced wholesale by the
 *    skeleton's fact-derived body/links — these are the two sections where an
 *    invented command (AC-8) or a re-ordered reading path (AC-4) would be the
 *    most damaging, so they never depend on trusting the model's free-form
 *    text. Every other section keeps the model's narration when it grounds
 *    cleanly, falling back to the skeleton section-by-section otherwise.
 *  - `diagram` is stripped from every section except `architecture`; a
 *    malformed `architecture` diagram is dropped to `null`, never breaks the
 *    tour (AC-13).
 *  - Every surviving `links` entry must reference a path present in the
 *    gathered facts (AC-15); an empty result after filtering falls back to
 *    the skeleton's own (fact-safe) links for that section.
 *  - `first_tasks` links additionally get a `complexity` badge grounded in a
 *    real import-graph signal — the file's `file_rank` percentile relative to
 *    every other path referenced by the tour (terciles), NOT list position.
 *    `null` when the path has no percentile fact (not present in the graph).
 */
export function groundOnboarding(generated: Onboarding, facts: OnboardingFacts): Onboarding {
  const skeleton = buildSkeleton(facts);
  const skeletonByKind = new Map(skeleton.sections.map((s) => [s.kind, s]));
  const generatedByKind = new Map((generated.sections ?? []).map((s) => [s.kind, s]));
  const allowedPaths = factPathSet(facts);

  const sections: OnboardingSection[] = ONBOARDING_SECTION_ORDER.map(({ kind, title }) => {
    const fallback = skeletonByKind.get(kind)!;

    // The two safety-critical sections are always fully deterministic.
    if (kind === 'run_local' || kind === 'reading_path') return fallback;

    const raw = generatedByKind.get(kind);
    if (!raw) {
      return kind === 'first_tasks' ? { ...fallback, links: withComplexity(fallback.links, facts) } : fallback;
    }

    const body = typeof raw.body === 'string' && raw.body.trim().length > 0 ? raw.body : fallback.body;
    const filteredLinks = filterLinks(raw.links, allowedPaths);
    const links = filteredLinks.length > 0 ? filteredLinks.slice(0, MAX_SECTION_LINKS) : fallback.links;
    const diagram = kind === 'architecture' ? validDiagram(raw.diagram) : null;
    const finalLinks = kind === 'first_tasks' ? withComplexity(links, facts) : links;

    return { kind, title, body, diagram, links: finalLinks };
  });

  return { sections };
}

/**
 * Grades each link's `complexity` from the file's `file_rank` percentile
 * relative to the OTHER paths the tour references (terciles over
 * `facts.filePercentiles`) — a real import-graph centrality signal, never the
 * link's position in the list. `null` when the path has no percentile fact.
 */
function withComplexity(links: OnboardingLink[], facts: OnboardingFacts): OnboardingLink[] {
  const percentiles = facts.filePercentiles ?? {};
  const population = Object.values(percentiles).sort((a, b) => a - b);
  return links.map((l) => ({ ...l, complexity: complexityBand(percentiles[l.path], population) }));
}

/** Terciles over `population` (ascending). `undefined` value -> not in the graph -> `null`. */
function complexityBand(
  value: number | undefined,
  population: number[],
): NonNullable<OnboardingLink['complexity']> | null {
  if (value === undefined || population.length === 0) return null;
  const t1 = population[Math.floor(population.length / 3)]!;
  const t2 = population[Math.floor((2 * population.length) / 3)]!;
  if (value >= t2) return 'high';
  if (value >= t1) return 'medium';
  return 'low';
}

/** The set of repo-relative paths the model is allowed to reference (AC-15). */
function factPathSet(facts: OnboardingFacts): Set<string> {
  const set = new Set<string>();
  for (const f of facts.rankedFiles) set.add(f.path);
  for (const c of facts.criticalPaths) set.add(c.path);
  return set;
}

function filterLinks(links: OnboardingLink[] | null | undefined, allowed: Set<string>): OnboardingLink[] {
  if (!links) return [];
  return links.filter((l) => allowed.has(l.path));
}

/** `safeParse`s the node/edge diagram payload; a malformed shape is dropped (AC-13). */
function validDiagram(raw: unknown): OnboardingSection['diagram'] {
  if (raw === null || raw === undefined) return null;
  const parsed = OnboardingDiagram.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
