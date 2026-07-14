import { AppShell } from "../../../../components/app-shell";
import { ProjectContextView } from "./_components/ProjectContextView";

/* Route: /repos/:repoId/context — read/preview-only Project Context screen
   (SPEC-01, Feature 1). Thin RSC shell; all fetching + rendering happens in
   the self-fetching client component below. */
export default async function ProjectContextPage({ params }: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await params;
  return (
    <AppShell crumb={[{ label: "Project Context" }]}>
      <ProjectContextView repoId={repoId} />
    </AppShell>
  );
}
