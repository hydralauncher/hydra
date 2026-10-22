import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import { useFormat } from "@renderer/hooks";
import type { MetricDefinition } from "./global-leaderboard";

export function useMetricText() {
  const { t } = useTranslation("leaderboards");
  const { numberFormatter } = useFormat();

  const label = useCallback(
    (metric: MetricDefinition) =>
      t(`metric_${metric.id}`, { defaultValue: metric.label }),
    [t]
  );

  const format = useCallback(
    (metric: MetricDefinition, value: number) => {
      if (metric.valueType === "duration") {
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
    [numberFormatter, t]
  );

  return { label, format };
}
