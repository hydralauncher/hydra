import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import { useFormat } from "@renderer/hooks";
import type { GlobalLeaderboardMetric } from "./global-leaderboard";

export function useGlobalLeaderboardValue() {
  const { t } = useTranslation("leaderboards");
  const { numberFormatter } = useFormat();

  return useCallback(
    (metric: GlobalLeaderboardMetric, value: number) => {
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

      return t(`value_${metric}`, {
        count: value,
        amount: numberFormatter.format(value),
      });
    },
    [numberFormatter, t]
  );
}
