import { useCallback, useEffect, useState } from "react";
import type { GameShop } from "@types";

export interface UseUserReviewStatusParams {
  shop?: GameShop;
  objectId?: string;
  userDetailsId?: string;
  recompilationSlug?: string;
}

interface UserReviewStatusResult {
  identity: string;
  hasReviewed: boolean;
}

// Last known answer per game and user. A revisit shows the right state on
// the first render instead of waiting for the check, which would move the
// page when the review prompt appears.
const reviewStatusCache = new Map<string, boolean>();

const buildIdentity = (
  shop?: GameShop,
  objectId?: string,
  userDetailsId?: string,
  recompilationSlug?: string
) =>
  `${shop ?? ""}:${objectId ?? ""}:${userDetailsId ?? ""}:${recompilationSlug ?? ""}`;

export function useUserReviewStatus({
  shop,
  objectId,
  userDetailsId,
  recompilationSlug,
}: Readonly<UseUserReviewStatusParams>) {
  const identity = buildIdentity(
    shop,
    objectId,
    userDetailsId,
    recompilationSlug
  );
  const [result, setResult] = useState<UserReviewStatusResult | null>(null);

  const rememberResult = useCallback(
    (hasReviewed: boolean) => {
      reviewStatusCache.set(identity, hasReviewed);
      setResult({ identity, hasReviewed });
    },
    [identity]
  );

  useEffect(() => {
    if (!shop || !objectId || shop === "custom" || !userDetailsId) {
      setResult({ identity, hasReviewed: false });
      return;
    }

    const cached = reviewStatusCache.get(identity);
    if (cached !== undefined) setResult({ identity, hasReviewed: cached });

    let cancelled = false;

    window.electron.hydraApi
      .get<{ hasReviewed: boolean }>(
        `/games/${shop}/${objectId}/reviews/check`,
        {
          needsAuth: true,
          params: recompilationSlug ? { recompilationSlug } : undefined,
        }
      )
      .then((response) => {
        if (cancelled) return;
        rememberResult(response?.hasReviewed || false);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Failed to check user review:", error);
        setResult({ identity, hasReviewed: false });
      });

    return () => {
      cancelled = true;
    };
  }, [
    identity,
    shop,
    objectId,
    userDetailsId,
    recompilationSlug,
    rememberResult,
  ]);

  const cachedResult = reviewStatusCache.has(identity)
    ? { identity, hasReviewed: reviewStatusCache.get(identity)! }
    : null;
  const currentResult = result?.identity === identity ? result : cachedResult;

  const updateHasUserReviewed = rememberResult;

  return {
    hasUserReviewed: currentResult?.hasReviewed ?? false,
    isCheckingUserReview: currentResult === null,
    updateHasUserReviewed,
  };
}
