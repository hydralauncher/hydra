import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SteamReviewSummary as SteamReviewSummaryData } from "@shared";

export interface SteamReviewSummaryProps {
  steamAppId: string;
}

/** Shows Steam's overall rating for a Steam game. Renders nothing if unavailable. */
export function SteamReviewSummary({ steamAppId }: SteamReviewSummaryProps) {
  const { t, i18n } = useTranslation("game_details");
  const [summary, setSummary] = useState<SteamReviewSummaryData | null>(null);

  useEffect(() => {
    let isCancelled = false;
    setSummary(null);

    window.electron
      .getSteamReviewSummary(steamAppId)
      .then((result) => {
        if (!isCancelled) setSummary(result);
      })
      .catch(() => {
        if (!isCancelled) setSummary(null);
      });

    return () => {
      isCancelled = true;
    };
  }, [steamAppId]);

  if (!summary) return null;

  return (
    <p>
      {t("steam_review_summary", {
        label: summary.reviewScoreDesc,
        reviews: summary.totalReviews.toLocaleString(i18n.language),
      })}
    </p>
  );
}
