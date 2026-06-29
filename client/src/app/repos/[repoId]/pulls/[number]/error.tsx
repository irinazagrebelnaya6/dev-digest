"use client";

import { ErrorState } from "@devdigest/ui";

export default function PRDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      fullScreen
      title="Couldn't load this pull request"
      body={error.message || "An unexpected error occurred."}
      onRetry={reset}
    />
  );
}
