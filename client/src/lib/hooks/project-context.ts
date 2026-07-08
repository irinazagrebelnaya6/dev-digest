/* hooks/project-context.ts — Project Context Folder (SPEC-01, Feature 1):
   discovers repo-relative `.md` docs under `specs`/`docs`/`insights` in the
   reviewed repo's clone, for (a) the attach pickers in the agent/skill editors
   and (b) the read/preview-only Project Context screen. Zero LLM calls — the
   server walks the clone and counts references, nothing more. Read-only: no
   mutation hooks here (attaching/detaching happens via useUpdateAgent /
   useUpdateSkill with a `context_paths` patch). */
"use client";

import { useQuery } from "@tanstack/react-query";
import type { ProjectContextDoc, ProjectContextResponse } from "@devdigest/shared";
import { api } from "../api";
import { queryKeys } from "../query-keys";

// Single source of truth = vendor/shared; re-export so any consumer importing
// these types from this hook keeps working.
export type { ProjectContextDoc, ProjectContextResponse };

/** Discoverable docs for a repo (`GET /repos/:id/project-context`). Degrades to
    an empty+degraded list (never an error) when the repo has no clone yet. */
export function useProjectContext(repoId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.projectContext(repoId),
    queryFn: () => api.get<ProjectContextResponse>(`/repos/${repoId}/project-context`),
    enabled: !!repoId,
  });
}
