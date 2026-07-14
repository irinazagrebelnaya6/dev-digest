"use client";

import { useParams } from "next/navigation";
import { AgentEvalDetailView } from "./_components/AgentEvalDetailView";

/* Route: /evals/:agentId — per-agent Eval Dashboard detail (SPEC-05 AC-18).
   Thin entry — the view and its Compare-runs modal are colocated under
   _components/. Mirrors the /agents/:id and /skills/:id dynamic-route shape. */
export default function AgentEvalDetailPage() {
  const params = useParams<{ agentId: string }>();
  return <AgentEvalDetailView agentId={params.agentId} />;
}
