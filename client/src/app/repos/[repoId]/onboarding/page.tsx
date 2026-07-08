import { AppShell } from "@/components/app-shell";
import { OnboardingTourView } from "./_components/OnboardingTourView";

/* Route: /repos/:repoId/onboarding — the Onboarding Tour (SPEC-03). Distinct
   from the existing full-screen `/onboarding` (Add-Repo) flow, which is left
   untouched. Thin RSC shell; all fetching + rendering happens in the
   self-fetching client component below (mirrors ProjectContextPage). */
export default async function OnboardingTourPage({
  params,
}: {
  params: Promise<{ repoId: string }>;
}) {
  const { repoId } = await params;
  return (
    <AppShell crumb={[{ label: "Onboarding Tour" }]}>
      <OnboardingTourView repoId={repoId} />
    </AppShell>
  );
}
