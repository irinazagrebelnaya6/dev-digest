"use client";

import { ErrorState } from "@devdigest/ui";

export default function ProjectContextError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      fullScreen
      title="Couldn't load project context"
      body={error.message || "An unexpected error occurred."}
      onRetry={reset}
    />
  );
}
