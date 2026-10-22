import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import { useFormat } from "@renderer/hooks";
import { getDurationParts, type LeaderboardMetric } from "./game-leaderboard";

export function useLeaderboardValue() {
  const { t } = useTranslation("leaderboard");
  const { numberFormatter } = useFormat();

  return useCallback(
    (metric: LeaderboardMetric, value: number) => {
      if (metric === "playtime") {
        const { unit, amount } = getDurationParts(
          value,
          MAX_MINUTES_TO_SHOW_IN_PLAYTIME
        );
        return t(`value_${unit}`, { amount: numberFormatter.format(amount) });
      }

      if (metric === "streak") {
        return t("value_days", { count: value });
      }

      return numberFormatter.format(value);
    },
    [numberFormatter, t]
  );
}
