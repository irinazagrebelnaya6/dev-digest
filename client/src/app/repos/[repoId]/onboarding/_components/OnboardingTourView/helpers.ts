/* helpers.ts — pure display-only helpers for the Onboarding Tour screen.
   NOT business logic: the server (`analyzer.ts`/`skeleton.ts`/`ground.ts`)
   owns every fact/grounding rule (AC-4/AC-8/AC-15). These functions only
   reshape the already-grounded `OnboardingSection.body` markdown into rows
   for the "How to run locally" copy buttons, and derive a purely cosmetic
   complexity badge for "First tasks" cards — neither invents a new fact. */

/** Splits a numbered-list markdown body ("1. foo\n2. bar") into item texts,
    stripping the leading "N. " marker. Falls back to non-empty lines when
    the body isn't a numbered list (e.g. the skeleton's degraded fallback
    prose) so the caller never sees a blank list. */
export function parseNumberedLines(body: string): string[] {
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const numbered = lines
    .filter((l) => /^\d+\.\s+/.test(l))
    .map((l) => l.replace(/^\d+\.\s+/, ""));
  return numbered.length > 0 ? numbered : lines;
}

/** Best-effort copyable command for a "How to run locally" row: the first
    inline-code (`backtick`) span in the line, which is how every fact-derived
    step is phrased (`skeleton.ts` `runLocalBody`), else the raw text. */
export function extractCommand(line: string): string {
  const m = line.match(/`([^`]+)`/);
  return m ? m[1]! : line;
}

/** Strips markdown emphasis/inline-code backticks for a plain-text label
    (used alongside the rendered <Markdown> row so the copy affordance's
    accessible name matches what's on screen). */
export function stripMarkdown(text: string): string {
  return text.replace(/`([^`]+)`/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1");
}

export type Complexity = "low" | "medium" | "high";

/** Cosmetic-only complexity badge for a "First tasks" card, derived from the
    card's position (earlier tasks are framed as easier entry points by the
    server's own ordering) — never a claim grounded in repo facts. */
export function complexityForIndex(index: number): Complexity {
  if (index === 0) return "low";
  if (index === 1) return "medium";
  return "high";
}
