/* hooks/smart-diff.ts — Smart Diff (risk-ordered "Files changed" view). No LLM
   call: the server deterministically groups already-loaded pr_files +
   already-computed findings by classifyFile(path). */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../query-keys";
import type { SmartDiffResponse } from "@devdigest/shared";

/** Risk-grouped diff (core/wiring/boilerplate) for a PR's Files changed tab. */
export function useSmartDiff(prId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.prSmartDiff(prId),
    queryFn: () => api.get<SmartDiffResponse>(`/pulls/${prId}/smart-diff`),
    enabled: !!prId,
  });
}
