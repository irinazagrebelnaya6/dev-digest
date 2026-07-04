/* hooks/intent.ts — PR intent (why the PR was opened + in/out of scope). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../query-keys";
import type { PrIntentRecord } from "@devdigest/shared";

/** Stored intent for a PR — null when none has been computed yet. */
export function useIntent(prId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.prIntent(prId),
    queryFn: () => api.get<PrIntentRecord | null>(`/pulls/${prId}/intent`),
    enabled: !!prId,
  });
}

/** Synchronously (re)compute + persist a PR's intent. Refreshes the card on success. */
export function useComputeIntent(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PrIntentRecord>(`/pulls/${prId}/intent`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.prIntent(prId) });
    },
  });
}
