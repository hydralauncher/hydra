import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import { useFormat } from "@renderer/hooks";
import type { LeaderboardMetric } from "./game-leaderboard";

const FRACTIONAL_HOURS_LIMIT = 10;
const HOUR_FRACTION_DIGITS = 1;

export function useLeaderboardValue() {
  const { t, i18n } = useTranslation("leaderboard");
  const { numberFormatter } = useFormat();
  const hourFormatter = useMemo(
    () =>
      new Intl.NumberFormat(i18n.language, {
        maximumFractionDigits: HOUR_FRACTION_DIGITS,
      }),
    [i18n.language]
  );

  return useCallback(
    (metric: LeaderboardMetric, value: number) => {
      if (metric === "playtime") {
        const minutes = value / 60;

        if (minutes < MAX_MINUTES_TO_SHOW_IN_PLAYTIME) {
          return t("value_minutes", {
            amount: numberFormatter.format(
              value > 0 ? Math.max(1, Math.round(minutes)) : 0
            ),
          });
        }

        const hours = minutes / 60;

        return t("value_hours", {
          amount:
            hours < FRACTIONAL_HOURS_LIMIT
              ? hourFormatter.format(hours)
              : numberFormatter.format(Math.round(hours)),
        });
      }

      if (metric === "streak") {
        return t("value_days", { count: value });
      }

      return numberFormatter.format(value);
    },
    [hourFormatter, numberFormatter, t]
  );
}
