import { useCallback, useEffect, useState } from "react";
import type { GameShop } from "@types";

export interface UseUserReviewStatusParams {
  shop?: GameShop;
  objectId?: string;
  userDetailsId?: string;
}

interface UserReviewStatusResult {
  identity: string;
  hasReviewed: boolean;
}

const buildIdentity = (
  shop?: GameShop,
  objectId?: string,
  userDetailsId?: string
) => `${shop ?? ""}:${objectId ?? ""}:${userDetailsId ?? ""}`;

export function useUserReviewStatus({
  shop,
  objectId,
  userDetailsId,
}: Readonly<UseUserReviewStatusParams>) {
  const identity = buildIdentity(shop, objectId, userDetailsId);
  const [result, setResult] = useState<UserReviewStatusResult | null>(null);

  useEffect(() => {
    if (!shop || !objectId || shop === "custom" || !userDetailsId) {
      setResult({ identity, hasReviewed: false });
      return;
    }

    let cancelled = false;

    window.electron.hydraApi
      .get<{ hasReviewed: boolean }>(
        `/games/${shop}/${objectId}/reviews/check`,
        { needsAuth: true }
      )
      .then((response) => {
        if (cancelled) return;
        setResult({ identity, hasReviewed: response?.hasReviewed || false });
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Failed to check user review:", error);
        setResult({ identity, hasReviewed: false });
      });

    return () => {
      cancelled = true;
    };
  }, [identity, shop, objectId, userDetailsId]);

  const currentResult = result?.identity === identity ? result : null;

  const updateHasUserReviewed = useCallback(
    (hasReviewed: boolean) => {
      setResult({ identity, hasReviewed });
    },
    [identity]
  );

  return {
    hasUserReviewed: currentResult?.hasReviewed ?? false,
    isCheckingUserReview: currentResult === null,
    updateHasUserReviewed,
  };
}
