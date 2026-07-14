/* hooks/project-context.ts — Project Context Folder.
   SPEC-01 (Feature 1): discovers repo-relative `.md` docs under
   `specs`/`docs`/`insights` in the reviewed repo's clone, for (a) the attach
   pickers in the agent/skill editors and (b) the Project Context screen.
   SPEC-02 (editing & toolbar): adds the authoring mutation hooks
   (`useWriteContextDoc`/`useUploadContextDoc`/`useCreateContextFolder`) that
   back the screen's toolbar + Preview|Edit editor. Zero LLM calls either
   way — the server only walks/writes the clone's working tree on disk (no
   git action); attaching/detaching a doc to an agent/skill still happens via
   useUpdateAgent / useUpdateSkill with a `context_paths` patch (unrelated to
   authoring the doc's own content). */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ContextFolderResult,
  ContextWriteResult,
  CreateContextFolderBody,
  ProjectContextDoc,
  ProjectContextResponse,
  UploadContextDocBody,
  WriteContextDocBody,
} from "@devdigest/shared";
import { api } from "../api";
import { queryKeys } from "../query-keys";

// Single source of truth = vendor/shared; re-export so any consumer importing
// these types from this hook keeps working.
export type {
  ContextFolderResult,
  ContextWriteResult,
  CreateContextFolderBody,
  ProjectContextDoc,
  ProjectContextResponse,
  UploadContextDocBody,
  WriteContextDocBody,
};

/** Discoverable docs for a repo (`GET /repos/:id/project-context`). Degrades to
    an empty+degraded list (never an error) when the repo has no clone yet. */
export function useProjectContext(repoId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.projectContext(repoId),
    queryFn: () => api.get<ProjectContextResponse>(`/repos/${repoId}/project-context`),
    enabled: !!repoId,
  });
}

/** Create-or-update one doc (`PUT /repos/:id/project-context/docs`, SPEC-02).
    `hash` present = update precondition (409 on mismatch, AC-13); absent =
    create (409 on path collision unless `overwrite`, AC-10). Callers surface
    `ApiError` (incl. status 409) themselves — this hook does not swallow it,
    so the caller can keep the edit buffer on failure (AC-16). */
export function useWriteContextDoc(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: WriteContextDocBody) =>
      api.put<ContextWriteResult>(`/repos/${repoId}/project-context/docs`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.projectContext(repoId) }),
  });
}

/** Upload a new doc into the currently-displayed root
    (`POST /repos/:id/project-context/uploads`, SPEC-02). Create-only — same
    409-on-collision-without-overwrite guard as the write route (AC-10). */
export function useUploadContextDoc(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UploadContextDocBody) =>
      api.post<ContextWriteResult>(`/repos/${repoId}/project-context/uploads`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.projectContext(repoId) }),
  });
}

/** Create a subdirectory under a configured root inside the clone
    (`POST /repos/:id/project-context/folders`, SPEC-02, AC-11). */
export function useCreateContextFolder(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateContextFolderBody) =>
      api.post<ContextFolderResult>(`/repos/${repoId}/project-context/folders`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.projectContext(repoId) }),
  });
}
