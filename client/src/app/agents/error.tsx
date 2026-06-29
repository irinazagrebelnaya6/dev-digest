"use client";

import { ErrorState } from "@devdigest/ui";

export default function AgentsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      fullScreen
      title="Couldn't load agents"
      body={error.message || "An unexpected error occurred."}
      onRetry={reset}
    />
  );
}
