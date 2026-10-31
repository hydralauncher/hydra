import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  getLanguageDisplayName,
  getReviewTranslation,
  sanitizeHtml,
} from "@shared";
import type { LeaderboardReview } from "./global-leaderboard";
import { useLeaderboardViewer } from "./leaderboards-api";

export interface ReviewTranslation {
  // Sanitized HTML of the translation in the app language, or null when the
  // original should be shown.
  translatedHtml: string | null;
  showOriginal: boolean;
  toggleOriginal: () => void;
  toggleLabel: string;
}

// Same rule as the game page (review-item.tsx), from the shared helper.
export function useReviewTranslation(
  review: LeaderboardReview,
  authorId: string
): ReviewTranslation {
  const { t, i18n } = useTranslation("game_details");
  const { viewerUser } = useLeaderboardViewer();
  const [showOriginal, setShowOriginal] = useState(false);

  // Each review starts translated, also when another entry is selected.
  useEffect(() => {
    setShowOriginal(false);
  }, [review, authorId]);
  const translation = getReviewTranslation({
    translations: review.translations,
    detectedLanguage: review.detectedLanguage,
    language: i18n.language,
    isOwnReview: viewerUser?.id === authorId,
  });

  return {
    translatedHtml: translation ? sanitizeHtml(translation) : null,
    showOriginal,
    toggleOriginal: () => setShowOriginal((value) => !value),
    toggleLabel: showOriginal
      ? t("hide_original")
      : t("show_original_translated_from", {
          language: getLanguageDisplayName(
            review.detectedLanguage,
            i18n.language
          ),
        }),
  };
}
