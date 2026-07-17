"use client";

import { useParams } from "next/navigation";
import { MultiAgentResultsView } from "./_components/MultiAgentResultsView";

/* Route: /multi-agent/:runId (Multi-Agent Review results, SPEC-06 AC-13..22).
   Thin entry — the view is colocated under _components/. */
export default function MultiAgentResultsPage() {
  const params = useParams<{ runId: string }>();
  return <MultiAgentResultsView runId={params.runId} />;
}
