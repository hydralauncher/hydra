import { useState } from "react";
import { useTranslation } from "react-i18next";

import { getReviewTranslationLanguage, sanitizeHtml } from "@shared";
import type { LeaderboardReview } from "./global-leaderboard";

const getBaseLanguage = (language: string | null) =>
  language?.split("-")[0] || "";

const getLanguageName = (languageCode: string | null, locale: string) => {
  if (!languageCode) return "";
  try {
    const displayNames = new Intl.DisplayNames([locale], { type: "language" });
    return displayNames.of(languageCode) || languageCode.toUpperCase();
  } catch {
    return languageCode.toUpperCase();
  }
};

export interface ReviewTranslation {
  // Sanitized HTML of the translation in the app language, or null when the
  // review is already in that language or the API sent no translation.
  translatedHtml: string | null;
  showOriginal: boolean;
  toggleOriginal: () => void;
  toggleLabel: string;
}

// Same rule as the game page (review-item.tsx): translate when the detected
// language differs from the app language and the API sent that translation.
export function useReviewTranslation(
  review: LeaderboardReview
): ReviewTranslation {
  const { t, i18n } = useTranslation("game_details");
  const [showOriginal, setShowOriginal] = useState(false);
  const translation =
    review.translations[getReviewTranslationLanguage(i18n.language)] ?? null;
  const isDifferentLanguage =
    getBaseLanguage(review.detectedLanguage) !== getBaseLanguage(i18n.language);
  const translatedHtml =
    isDifferentLanguage && translation ? sanitizeHtml(translation) : null;

  return {
    translatedHtml,
    showOriginal,
    toggleOriginal: () => setShowOriginal((value) => !value),
    toggleLabel: showOriginal
      ? t("hide_original")
      : t("show_original_translated_from", {
          language: getLanguageName(review.detectedLanguage, i18n.language),
        }),
  };
}
