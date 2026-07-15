import { EvalDashboardView } from "./_components/EvalDashboardView";

/* Route: /evals (Eval Dashboard, SPEC-05 AC-15/AC-17). Thin entry — the view
   and its per-agent row + helpers are colocated under _components/. */
export default function EvalDashboardPage() {
  return <EvalDashboardView />;
}
