"use client";

import { ErrorState } from "@devdigest/ui";

export default function SkillsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      fullScreen
      title="Couldn't load skills"
      body={error.message || "An unexpected error occurred."}
      onRetry={reset}
    />
  );
}
