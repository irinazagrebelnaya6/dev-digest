/* hooks/blast.ts — Blast Radius (PR impact map). No LLM call by default: the
   server reads the pre-built repo-intel index (changed symbols → callers →
   affected endpoints). Pass `summary: true` to request the one optional
   cheap-model paragraph. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../query-keys";
import type { BlastRadiusResponse } from "@devdigest/shared";

/** Impact map for a PR. `summary` opts into the single cheap-model explanation. */
export function useBlast(prId: string | null | undefined, summary = false) {
  return useQuery({
    queryKey: [...queryKeys.prBlast(prId), summary] as const,
    queryFn: () =>
      api.get<BlastRadiusResponse>(`/pulls/${prId}/blast${summary ? "?summary=1" : ""}`),
    enabled: !!prId,
  });
}
