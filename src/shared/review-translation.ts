// Shared by the game page reviews (review-item.tsx) and the leaderboard
// reviews (use-review-translation.ts), so both pick the same translation.

const getBaseLanguage = (language: string | null) =>
  language?.split("-")[0] || "";

export const getReviewTranslationLanguage = (language: string) =>
  language.split("-")[0].toLowerCase();

// The translation to show instead of the original, or null: never for the
// viewer's own review, only when the review was written in another language
// and the API sent a translation for the app language.
export const getReviewTranslation = ({
  translations,
  detectedLanguage,
  language,
  isOwnReview,
}: {
  translations: Record<string, string>;
  detectedLanguage: string | null;
  language: string;
  isOwnReview: boolean;
}): string | null => {
  if (isOwnReview) return null;
  if (getBaseLanguage(detectedLanguage) === getBaseLanguage(language)) {
    return null;
  }

  return translations[getReviewTranslationLanguage(language)] || null;
};

export const getLanguageDisplayName = (
  languageCode: string | null,
  locale: string
) => {
  if (!languageCode) return "";
  try {
    const displayNames = new Intl.DisplayNames([locale], { type: "language" });
    return displayNames.of(languageCode) || languageCode.toUpperCase();
  } catch {
    return languageCode.toUpperCase();
  }
};
