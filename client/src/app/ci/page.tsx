import { CiRunsPage } from "./_components/CiRunsPage";

/* Route: /ci (SPEC-06 AC-12, global CI Runs). Thin RSC entry — the view, its
   columns, helpers and i18n are colocated under _components/CiRunsPage. */
export default function CiRunsRoute() {
  return <CiRunsPage />;
}
