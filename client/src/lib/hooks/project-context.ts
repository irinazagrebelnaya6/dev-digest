/* hooks/project-context.ts — Project Context Folder (SPEC-01, Feature 1):
   discovers repo-relative `.md` docs under `specs`/`docs`/`insights` in the
   reviewed repo's clone, for (a) the attach pickers in the agent/skill editors
   and (b) the read/preview-only Project Context screen. Zero LLM calls — the
   server walks the clone and counts references, nothing more. Read-only: no
   mutation hooks here (attaching/detaching happens via useUpdateAgent /
   useUpdateSkill with a `context_paths` patch). */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../query-keys";

/** One discoverable markdown doc in the reviewed repo's clone. */
export interface ProjectContextDoc {
  /** Repo-relative, forward-slash path (e.g. "specs/SPEC-01.md"). */
  path: string;
  /** Badge derived from the nearest ancestor root folder (e.g. "specs"). */
  type: string;
  /** Distinct agents referencing this doc directly or via an inherited skill. */
  used_by: number;
  /** Full markdown body, when the server includes it for the preview screen.
      Read/preview only — never editable client-side (AC-13 screen scope). */
  content?: string | null;
}

export interface ProjectContextResponse {
  docs: ProjectContextDoc[];
  /** True when the repo isn't cloned yet / the walk couldn't run — still a 200. */
  degraded: boolean;
  reason?: string | null;
}

/** Discoverable docs for a repo (`GET /repos/:id/project-context`). Degrades to
    an empty+degraded list (never an error) when the repo has no clone yet. */
export function useProjectContext(repoId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.projectContext(repoId),
    queryFn: () => api.get<ProjectContextResponse>(`/repos/${repoId}/project-context`),
    enabled: !!repoId,
  });
}
