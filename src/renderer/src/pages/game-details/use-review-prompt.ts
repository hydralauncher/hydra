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

const REVIEW_PROMPT_DISMISSED_STORAGE_KEY = "reviewPromptDismissedAt";

const readDismissal = () => {
  try {
    const storedValue = localStorage.getItem(
      REVIEW_PROMPT_DISMISSED_STORAGE_KEY
    );
    if (!storedValue) return false;

    const dismissedAt = Number(storedValue);

    if (
      Number.isFinite(dismissedAt) &&
      Date.now() - dismissedAt < REVIEW_PROMPT_DISMISS_TTL_IN_MS
    ) {
      return true;
    }

    localStorage.removeItem(REVIEW_PROMPT_DISMISSED_STORAGE_KEY);
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
  const [isDismissed, setIsDismissed] = useState(readDismissal);

  useEffect(() => {
    setIsDismissed(readDismissal());
  }, [shop, objectId]);

  const dismissPrompt = useCallback(({ persist }: { persist: boolean }) => {
    setIsDismissed(true);

    if (!persist) return;

    try {
      localStorage.setItem(
        REVIEW_PROMPT_DISMISSED_STORAGE_KEY,
        Date.now().toString()
      );
    } catch (error) {
      console.error("Failed to persist review prompt dismissal:", error);
    }
  }, []);

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
