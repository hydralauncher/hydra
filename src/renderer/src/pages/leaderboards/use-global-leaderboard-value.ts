import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import { useFormat } from "@renderer/hooks";
import { formatDurationParts } from "../game-details/leaderboard/game-leaderboard";
import type { MetricDefinition } from "./global-leaderboard";

export function useMetricText() {
  const { t, i18n } = useTranslation("leaderboards");
  const { numberFormatter } = useFormat();

  const label = useCallback(
    (metric: MetricDefinition) =>
      t(`metric_${metric.id}`, { defaultValue: metric.label }),
    [t]
  );

  const format = useCallback(
    (metric: MetricDefinition, value: number) => {
      if (metric.valueType === "duration") {
        const { unit, amount } = formatDurationParts(
          value,
          MAX_MINUTES_TO_SHOW_IN_PLAYTIME,
          i18n.language
        );
        return t(`value_${unit}`, { amount });
      }

      if (metric.valueType === "days") {
        return t("days_count", { count: value });
      }

      const amount = numberFormatter.format(value);
      return t(`value_${metric.id}`, {
        count: value,
        amount,
        defaultValue: amount,
      });
    },
    [i18n.language, numberFormatter, t]
  );

  return { label, format };
}
