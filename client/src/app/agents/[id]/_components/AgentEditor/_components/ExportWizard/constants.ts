import type { IconName } from "@devdigest/ui";
import type { CiTarget } from "@devdigest/shared";
import type { TriggerState } from "./types";

export const MODAL_WIDTH = 860;

/** GHA is the only target the `agent-runner` currently supports — preselected
 *  and badged "recommended" (spec Q7 / AC-1). */
export const RECOMMENDED_TARGET: CiTarget = "gha";

export const TARGET_OPTIONS: { id: CiTarget; icon: IconName }[] = [
  { id: "gha", icon: "Workflow" },
  { id: "circle", icon: "GitBranch" },
  { id: "jenkins", icon: "Wrench" },
  { id: "cli", icon: "Command" },
];

/** Trigger defaults: `opened` + `synchronize` always on, `reopened` off (AC-5). */
export const DEFAULT_TRIGGERS: TriggerState = {
  opened: true,
  synchronize: true,
  reopened: false,
};

export const DEFAULT_BASE = "main";

/** `owner/name` — strict shape matching server validation (AC-15).
 *  Each segment must start/end with alphanumeric; middle may contain `.`, `_`, `-`.
 *  Rejects path traversal, shell metacharacters, whitespace.
 *  Byte-identical to server `modules/ci/helpers.ts:REPO_SLUG_RE` to prevent UX mismatch. */
export const REPO_SLUG_RE =
  /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?\/[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;

export function isValidRepoSlug(repo: string): boolean {
  const trimmed = repo.trim();
  return REPO_SLUG_RE.test(trimmed) && !trimmed.includes("..");
}
