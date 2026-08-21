import { useCallback, useEffect, useState } from "react";
import type { GameShop } from "@types";

import {
  REVIEW_MIN_PLAYTIME_IN_MS,
  REVIEW_PROMPT_DISMISS_TTL_IN_MS,
} from "@renderer/constants";

export interface UseReviewPromptParams {
  shop?: GameShop;
  objectId?: string;
  playTimeInMilliseconds: number;
  userDetailsId?: string;
  isGameInLibrary: boolean;
  hasUserReviewed: boolean;
  isCheckingUserReview: boolean;
}

const getStorageKey = (shop: GameShop, objectId: string) =>
  `reviewPromptDismissed_${shop}_${objectId}`;

const readDismissal = (shop?: GameShop, objectId?: string) => {
  if (!shop || !objectId) return false;

  const key = getStorageKey(shop, objectId);

  try {
    const storedValue = localStorage.getItem(key);
    if (!storedValue) return false;

    const dismissedAt = Number(storedValue);

    if (
      Number.isFinite(dismissedAt) &&
      Date.now() - dismissedAt < REVIEW_PROMPT_DISMISS_TTL_IN_MS
    ) {
      return true;
    }

    localStorage.removeItem(key);
    return false;
  } catch (error) {
    console.error("Failed to read review prompt dismissal:", error);
    return false;
  }
};

export function useReviewPrompt({
  shop,
  objectId,
  playTimeInMilliseconds,
  userDetailsId,
  isGameInLibrary,
  hasUserReviewed,
  isCheckingUserReview,
}: Readonly<UseReviewPromptParams>) {
  const [isDismissed, setIsDismissed] = useState(() =>
    readDismissal(shop, objectId)
  );

  useEffect(() => {
    setIsDismissed(readDismissal(shop, objectId));
  }, [shop, objectId]);

  const dismissPrompt = useCallback(
    ({ persist }: { persist: boolean }) => {
      setIsDismissed(true);

      if (!persist || !shop || !objectId) return;

      try {
        localStorage.setItem(
          getStorageKey(shop, objectId),
          Date.now().toString()
        );
      } catch (error) {
        console.error("Failed to persist review prompt dismissal:", error);
      }
    },
    [shop, objectId]
  );

  const showPrompt =
    Boolean(shop) &&
    Boolean(objectId) &&
    shop !== "custom" &&
    Boolean(userDetailsId) &&
    isGameInLibrary &&
    !isCheckingUserReview &&
    !hasUserReviewed &&
    !isDismissed &&
    playTimeInMilliseconds >= REVIEW_MIN_PLAYTIME_IN_MS;

  return { showPrompt, dismissPrompt };
}
