import { ConventionsView } from "./_components/ConventionsView";

/* Route: /repos/:repoId/conventions */
export default async function ConventionsPage({ params }: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await params;
  return <ConventionsView repoId={repoId} />;
}
