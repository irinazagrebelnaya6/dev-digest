"use client";

import { ErrorState } from "@devdigest/ui";

export default function OnboardingTourError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      fullScreen
      title="Couldn't load the onboarding tour"
      body={error.message || "An unexpected error occurred."}
      onRetry={reset}
    />
  );
}
