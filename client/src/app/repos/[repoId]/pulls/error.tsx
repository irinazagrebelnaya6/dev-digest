"use client";

import { ErrorState } from "@devdigest/ui";

export default function PullsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      fullScreen
      title="Couldn't load pull requests"
      body={error.message || "An unexpected error occurred."}
      onRetry={reset}
    />
  );
}
