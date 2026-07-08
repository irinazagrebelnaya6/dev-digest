/* hooks/onboarding.ts — Onboarding Tour (SPEC-03).
   GET /repos/:id/onboarding serves the cached tour or generates-on-first-view
   (ZERO model calls on a repeat view, AC-17). POST .../regenerate always makes
   exactly one fresh structured call and advances `generatedAt`. Both funnel
   through the same `OnboardingResponse` contract — the regenerate mutation
   writes the fresh response straight into the query cache (no extra refetch)
   and also invalidates it, matching the other mutation hooks in this file. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OnboardingResponse } from "@devdigest/shared";
import { api } from "../api";
import { queryKeys } from "../query-keys";

// Single source of truth = vendor/shared; re-export so any consumer importing
// this type from the hook keeps working.
export type { OnboardingResponse };

/** Cached (or generate-on-first-view) tour for a repo (`GET /repos/:id/onboarding`). */
export function useOnboarding(repoId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.onboarding(repoId),
    queryFn: () => api.get<OnboardingResponse>(`/repos/${repoId}/onboarding`),
    enabled: !!repoId,
  });
}

/** Forces a fresh tour (`POST /repos/:id/onboarding/regenerate`) — exactly one
    new structured call server-side, advances `generatedAt` (AC-3/AC-17). */
export function useRegenerateOnboarding(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<OnboardingResponse>(`/repos/${repoId}/onboarding/regenerate`),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.onboarding(repoId), data);
      qc.invalidateQueries({ queryKey: queryKeys.onboarding(repoId) });
    },
  });
}
