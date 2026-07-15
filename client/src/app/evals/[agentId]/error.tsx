"use client";

import { ErrorState } from "@devdigest/ui";

export default function AgentEvalDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      fullScreen
      title="Couldn't load this agent's eval dashboard"
      body={error.message || "An unexpected error occurred."}
      onRetry={reset}
    />
  );
}
