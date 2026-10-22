import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import { useFormat } from "@renderer/hooks";
import {
  formatDurationParts,
  type LeaderboardMetric,
} from "./game-leaderboard";

export function useLeaderboardValue() {
  const { t, i18n } = useTranslation("leaderboard");
  const { numberFormatter } = useFormat();

  return useCallback(
    (metric: LeaderboardMetric, value: number) => {
      if (metric === "playtime") {
        const { unit, amount } = formatDurationParts(
          value,
          MAX_MINUTES_TO_SHOW_IN_PLAYTIME,
          i18n.language
        );
        return t(`value_${unit}`, { amount });
      }

      if (metric === "streak") {
        return t("value_days", { count: value });
      }

      return numberFormatter.format(value);
    },
    [i18n.language, numberFormatter, t]
  );
}
