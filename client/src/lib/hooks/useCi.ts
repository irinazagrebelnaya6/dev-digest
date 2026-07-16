/* hooks/useCi.ts — React Query hooks for SPEC-06 Export to CI: the Export
   Wizard (generate/export artifacts), the Agent Editor's CI tab (installations
   + agent runs), and the workspace-wide CI Runs page (filterable). Route
   surface mirrors the `[API]` track's `server/src/modules/ci/routes.ts` exactly:

     POST /agents/:id/export-ci               -> CiExport
     GET  /agents/:id/ci/installations        -> CiInstallation[]
     GET  /agents/:id/ci/runs                 -> CiRun[]
     GET  /ci/runs?repo=&agent_id=            -> CiRun[]
*/
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../query-keys";
import type { CiExport, CiExportInputBody, CiFailOn, CiInstallation, CiRun } from "@devdigest/shared";

export type { CiExport, CiExportInputBody, CiInstallation, CiRun };

/**
 * `CiRun` (the shared contract) has no `repo` field yet, but AC-12 requires a
 * Repository column + filter on the workspace-wide CI Runs page. The `[API]`
 * track's `GET /ci/runs` joins `ci_installations.repo` to answer that — until
 * the shared `eval-ci.ts` contract is extended with it (a vendor-sync step,
 * out of this track's scope), this local type tolerates the extra field so
 * the UI can read it defensively (`run.repo ?? "—"`) without a hard contract
 * dependency. Flagged to the orchestrator / API track.
 */
export interface CiRunRecord extends CiRun {
  repo?: string;
}

/** Installations for one agent (CI tab, AC-10). */
export function useAgentCiInstallations(agentId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.ciInstallations(agentId),
    queryFn: () => api.get<CiInstallation[]>(`/agents/${agentId}/ci/installations`),
    enabled: !!agentId,
  });
}

/** Latest CI runs for one agent, across all its installations (CI tab, AC-11). */
export function useAgentCiRuns(agentId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.agentCiRuns(agentId),
    queryFn: () => api.get<CiRunRecord[]>(`/agents/${agentId}/ci/runs`),
    enabled: !!agentId,
  });
}

export interface WorkspaceCiRunsFilters {
  repo?: string;
  agent_id?: string;
}

/** Workspace-wide CI runs for the top-level `/ci` page (AC-12), filterable by
 *  repo (free text) and agent id. Both filters fold into the query key so
 *  changing either triggers a fresh fetch — the server does the filtering. */
export function useWorkspaceCiRuns(filters?: WorkspaceCiRunsFilters) {
  const repo = filters?.repo?.trim() || undefined;
  const agentId = filters?.agent_id || undefined;
  return useQuery({
    queryKey: queryKeys.workspaceCiRuns(repo, agentId),
    queryFn: () => {
      const params = new URLSearchParams();
      if (repo) params.set("repo", repo);
      if (agentId) params.set("agent_id", agentId);
      const qs = params.toString();
      return api.get<CiRunRecord[]>(`/ci/runs${qs ? `?${qs}` : ""}`);
    },
  });
}

/** POST /agents/:id/export-ci — generates the CI bundle and, for
 *  `action: "open_pr"`, opens the PR. `action: "files"` (used by the wizard's
 *  Preview step + the zip degraded path) returns the files with no GitHub
 *  side-effect and must NOT be treated as "installed". */
export function useExportCi(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CiExportInputBody) => api.post<CiExport>(`/agents/${agentId}/export-ci`, input),
    onSuccess: (data) => {
      if (data.pr_url) {
        qc.invalidateQueries({ queryKey: queryKeys.ciInstallations(agentId) });
        qc.invalidateQueries({ queryKey: queryKeys.agentCiRuns(agentId) });
      }
    },
  });
}

/** "Fail CI on" is an agent-level field (`Agent.ci_fail_on`, not a column on
 *  `ci_installations`) — changing it for an installation (AC-13) means: (1)
 *  PATCH the agent's `ci_fail_on`, then (2) re-export (`action: "open_pr"`)
 *  against that installation's repo/target so the regenerated manifest and a
 *  fresh `devdigest/ci` PR carry the new value. Both steps run through the
 *  existing `/agents/:id` and `/agents/:id/export-ci` routes — no new route. */
export function useUpdateCiFailOn(agentId: string, installation: Pick<CiInstallation, "repo" | "target_type">) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ciFailOn: CiFailOn) => {
      await api.put(`/agents/${agentId}`, { ci_fail_on: ciFailOn });
      return api.post<CiExport>(`/agents/${agentId}/export-ci`, {
        repo: installation.repo,
        target: installation.target_type,
        action: "open_pr",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.agent(agentId) });
      qc.invalidateQueries({ queryKey: queryKeys.ciInstallations(agentId) });
      qc.invalidateQueries({ queryKey: queryKeys.agentCiRuns(agentId) });
    },
  });
}
