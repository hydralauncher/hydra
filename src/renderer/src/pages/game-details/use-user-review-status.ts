import { useCallback, useEffect, useState } from "react";
import type { GameShop } from "@types";

export interface UseUserReviewStatusParams {
  shop?: GameShop;
  objectId?: string;
  userDetailsId?: string;
}

export function useUserReviewStatus({
  shop,
  objectId,
  userDetailsId,
}: Readonly<UseUserReviewStatusParams>) {
  const [hasUserReviewed, setHasUserReviewed] = useState(false);
  const [isCheckingUserReview, setIsCheckingUserReview] = useState(true);

  useEffect(() => {
    setHasUserReviewed(false);

    if (!shop || !objectId || shop === "custom" || !userDetailsId) {
      setIsCheckingUserReview(false);
      return;
    }

    let cancelled = false;
    setIsCheckingUserReview(true);

    window.electron.hydraApi
      .get<{ hasReviewed: boolean }>(
        `/games/${shop}/${objectId}/reviews/check`,
        { needsAuth: true }
      )
      .then((response) => {
        if (cancelled) return;
        setHasUserReviewed(response?.hasReviewed || false);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Failed to check user review:", error);
      })
      .finally(() => {
        if (cancelled) return;
        setIsCheckingUserReview(false);
      });

    return () => {
      cancelled = true;
    };
  }, [shop, objectId, userDetailsId]);

  const updateHasUserReviewed = useCallback((hasReviewed: boolean) => {
    setHasUserReviewed(hasReviewed);
  }, []);

  return { hasUserReviewed, isCheckingUserReview, updateHasUserReviewed };
}
