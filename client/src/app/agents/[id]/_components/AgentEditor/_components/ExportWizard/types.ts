import type { CiFile, CiTarget } from "@devdigest/shared";

/** The wizard's 4 steps, in order (matches `ExportWizardSteps`'s progress bar). */
export type WizardStepKey = "target" | "preview" | "configure" | "install";

export const WIZARD_STEPS: readonly WizardStepKey[] = ["target", "preview", "configure", "install"];

export interface TriggerState {
  opened: boolean;
  synchronize: boolean;
  reopened: boolean;
}

export type PostAs = "github_review" | "pr_comment" | "none";

/** Degraded path (AC-8): "Copy files as a zip" performs no GitHub write. */
export type InstallAction = "open_pr" | "files";

/** The four artifact categories the Preview step lists (AC-2). `workflow` is
 *  the only editable one — the rest are generated read-only. */
export interface CategorizedFiles {
  manifest: CiFile | null;
  skills: CiFile[];
  memory: CiFile | null;
  workflow: CiFile | null;
}

/** Everything the wizard tracks across its 4 steps. */
export interface WizardState {
  step: WizardStepKey;
  repo: string;
  target: CiTarget;
  base: string;
  action: InstallAction;
  postAs: PostAs;
  triggers: TriggerState;
  artifacts: CiFile[] | null;
  prUrl: string | null;
  error: string | null;
}
