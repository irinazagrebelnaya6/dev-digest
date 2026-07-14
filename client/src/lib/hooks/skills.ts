/* hooks/skills.ts — React Query hooks for the A1 Skills library + agent skill linking. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../query-keys";
import type { AgentSkillLink, Skill, SkillSource, SkillType } from "@devdigest/shared";

export function useSkills() {
  return useQuery({
    queryKey: queryKeys.skills(),
    queryFn: () => api.get<Skill[]>("/skills"),
  });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.skill(id),
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

export interface CreateSkillInput {
  name: string;
  description?: string;
  type: SkillType;
  source?: SkillSource;
  body: string;
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) => api.post<Skill>("/skills", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.skills() }),
  });
}

export interface UpdateSkillInput {
  id: string;
  patch: Partial<Pick<Skill, "name" | "description" | "type" | "body" | "enabled" | "context_paths">>;
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSkillInput) => api.put<Skill>(`/skills/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: queryKeys.skills() });
      qc.invalidateQueries({ queryKey: queryKeys.skillVersions(data.id) });
      qc.invalidateQueries({ queryKey: queryKeys.skillStats(data.id) });
      qc.setQueryData(queryKeys.skill(data.id), data);
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/skills/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: queryKeys.skills() });
      qc.removeQueries({ queryKey: queryKeys.skill(id) });
    },
  });
}

export interface SkillStats {
  agents_count: number;
  version_count: number;
  created_at: string;
}

export interface SkillVersionEntry {
  skill_id: string;
  version: number;
  body: string;
  created_at: string;
}

export function useSkillStats(id: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.skillStats(id),
    queryFn: () => api.get<SkillStats>(`/skills/${id}/stats`),
    enabled: !!id,
  });
}

export function useSkillVersions(id: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.skillVersions(id),
    queryFn: () => api.get<SkillVersionEntry[]>(`/skills/${id}/versions`),
    enabled: !!id,
  });
}

export function useRestoreSkillVersion(skillId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (version: number) =>
      // No body — all input comes from URL params. Sending {} would set
      // content-type: application/json which Fastify may reject without a body schema.
      api.post<Skill>(`/skills/${skillId}/versions/${version}/restore`),
    onSuccess: (data) => {
      // Update skill synchronously so ConfigTab body is correct immediately.
      qc.setQueryData(queryKeys.skill(skillId), data);
      // Prepend the new version entry so the "current" badge appears in the
      // Versions tab without waiting for the async refetch to complete.
      const prev = qc.getQueryData<SkillVersionEntry[]>(queryKeys.skillVersions(skillId)) ?? [];
      qc.setQueryData(queryKeys.skillVersions(skillId), [
        { skill_id: skillId, version: data.version, body: data.body, created_at: new Date().toISOString() },
        ...prev,
      ]);
      qc.invalidateQueries({ queryKey: queryKeys.skillVersions(skillId) });
      qc.invalidateQueries({ queryKey: queryKeys.skills() });
      qc.invalidateQueries({ queryKey: queryKeys.skillStats(skillId) });
    },
  });
}

/** Linked skills for an agent as AgentSkillLink[] (ordered). */
export function useAgentSkills(agentId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.agentSkills(agentId),
    queryFn: () => api.get<AgentSkillLink[]>(`/agents/${agentId}/skills`),
    enabled: !!agentId,
  });
}

/** Replace the full ordered set of linked skills for an agent. */
export function useSetAgentSkills(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (skillIds: string[]) =>
      api.post<AgentSkillLink[]>(`/agents/${agentId}/skills`, { skill_ids: skillIds }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.agentSkills(agentId) }),
  });
}
