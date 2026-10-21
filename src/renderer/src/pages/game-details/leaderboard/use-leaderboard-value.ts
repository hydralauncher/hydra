import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import { useFormat } from "@renderer/hooks";
import type { LeaderboardMetric } from "./game-leaderboard";

export function useLeaderboardValue() {
  const { t } = useTranslation("leaderboard");
  const { numberFormatter } = useFormat();

  return useCallback(
    (metric: LeaderboardMetric, value: number) => {
      if (metric === "playtime") {
        const minutes = value / 60;

        if (minutes < MAX_MINUTES_TO_SHOW_IN_PLAYTIME) {
          return t("value_minutes", {
            amount: numberFormatter.format(Math.round(minutes)),
          });
        }

        return t("value_hours", {
          amount: numberFormatter.format(Math.round(minutes / 60)),
        });
      }

      if (metric === "streak") {
        return t("value_days", { count: value });
      }

      return numberFormatter.format(value);
    },
    [numberFormatter, t]
  );
}
