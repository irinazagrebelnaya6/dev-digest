/* hooks/conventions.ts — React Query hooks for Conventions Extractor feature. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../query-keys";
import type { ConventionCandidate, ConventionStatus } from "@devdigest/shared";

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.conventions(repoId),
    queryFn: () => api.get<ConventionCandidate[]>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

export interface ExtractResult {
  run_id: string;
  total: number;
  kept: number;
  dropped: number;
  candidates: ConventionCandidate[];
}

export function useExtractConventions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, force }: { repoId: string; force?: boolean }) =>
      api.post<ExtractResult>(`/repos/${repoId}/conventions/extract`, { force }),
    onSuccess: (_d, { repoId }) =>
      qc.invalidateQueries({ queryKey: queryKeys.conventions(repoId) }),
  });
}

export function useUpdateConventionStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      status,
      rule,
      category,
    }: {
      id: string;
      status?: ConventionStatus;
      rule?: string;
      category?: string;
      repoId: string;
    }) => api.patch<ConventionCandidate>(`/conventions/${id}`, { status, rule, category }),
    onSuccess: (_d, { repoId }) =>
      qc.invalidateQueries({ queryKey: queryKeys.conventions(repoId) }),
  });
}

export interface BuildSkillResult {
  skill: { id: string; name: string };
  linked: boolean;
}

export function useBuildConventionsSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      repoId,
      agentId,
      name,
      description,
      body,
    }: {
      repoId: string;
      agentId?: string;
      name?: string;
      description?: string;
      body?: string;
    }) =>
      api.post<BuildSkillResult>(`/repos/${repoId}/conventions/build-skill`, {
        agent_id: agentId,
        name,
        description,
        body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.skills() }),
  });
}
