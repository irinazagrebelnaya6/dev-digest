/* hooks/risks.ts — PR risk areas (LLM-derived merge-risk assessment). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../query-keys";
import type { PrRisksRecord } from "@devdigest/shared";

/** Stored risk assessment for a PR — null when none has been computed yet. */
export function useRisks(prId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.prRisks(prId),
    queryFn: () => api.get<PrRisksRecord | null>(`/pulls/${prId}/risks`),
    enabled: !!prId,
  });
}

/** Synchronously (re)compute + persist a PR's risk areas. Refreshes the card on success. */
export function useComputeRisks(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PrRisksRecord>(`/pulls/${prId}/risks`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.prRisks(prId) });
    },
  });
}
