/* hooks/brief.ts — Why + Risk Brief (SPEC-04).
   GET /pulls/:id/brief serves the cached `brief` slice or generates-on-first-view
   (ZERO model calls on a repeat view, AC-6). POST .../brief/regenerate always
   makes exactly one fresh structured call and overwrites the slice (AC-7). Both
   funnel through the same `BriefResponse` contract — mirrors hooks/onboarding.ts. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BriefResponse } from "@devdigest/shared";
import { api } from "../api";
import { queryKeys } from "../query-keys";

// Single source of truth = vendor/shared; re-export so any consumer importing
// this type from the hook keeps working.
export type { BriefResponse };

/** Cached (or generate-on-first-view) Why + Risk Brief for a PR (`GET /pulls/:id/brief`). */
export function usePrBrief(prId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.prBrief(prId),
    queryFn: () => api.get<BriefResponse>(`/pulls/${prId}/brief`),
    enabled: !!prId,
  });
}

/** Forces a fresh brief (`POST /pulls/:id/brief/regenerate`) — exactly one new
    structured call server-side, overwrites the persisted `brief` slice (AC-7). */
export function useRegeneratePrBrief(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<BriefResponse>(`/pulls/${prId}/brief/regenerate`),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.prBrief(prId), data);
      qc.invalidateQueries({ queryKey: queryKeys.prBrief(prId) });
    },
  });
}
