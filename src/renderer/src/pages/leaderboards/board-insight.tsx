import { StarIcon } from "@primer/octicons-react";
import { Trans, useTranslation } from "react-i18next";

import { useFormat } from "@renderer/hooks";
import {
  getBoardInsight,
  type GlobalLeaderboard,
  type GlobalLeaderboardPeriod,
  type MetricDefinition,
} from "./global-leaderboard";
import { useMetricText } from "./use-global-leaderboard-value";

// The streak does not restart with the week, so it has no deadline.
const METRICS_WITHOUT_DEADLINE = new Set(["streak"]);

export function BoardInsight({
  leaderboard,
  viewerId,
  metric,
  period,
}: Readonly<{
  leaderboard: GlobalLeaderboard;
  viewerId: string | null;
  metric: MetricDefinition;
  period: GlobalLeaderboardPeriod;
}>) {
  const { t } = useTranslation("leaderboards");
  const { numberFormatter } = useFormat();
  const metricText = useMetricText();
  const insight = getBoardInsight(leaderboard, viewerId);
  if (!insight) return null;

  // Boards show some counts without a unit, so the sentence names it here.
  const amount = (value: number) =>
    t(`insight_amount_${metric.id}`, {
      count: value,
      amount: numberFormatter.format(value),
      defaultValue: metricText.format(metric, value),
    });

  const hasDeadline =
    period === "week" && !METRICS_WITHOUT_DEADLINE.has(metric.id);
  // Display names can contain tags, so they are escaped before the tags in the
  // sentence are read, and unescaped again when rendered.
  const line = (
    key: string,
    values: Record<string, string>,
    defaults?: string
  ) => (
    <Trans
      t={t}
      i18nKey={key}
      values={values}
      defaults={defaults}
      components={{ b: <b /> }}
      tOptions={{ interpolation: { escapeValue: true } }}
      shouldUnescape
    />
  );

  let main = line("insight_leading_alone", {});
  let detail: React.ReactNode = null;

  if (insight.type === "unranked") {
    main = line(`insight_unranked_${metric.id}`, {}, t("insight_unranked"));
  } else if (insight.type === "ranked") {
    main = line("insight_ranked", {
      rank: numberFormatter.format(insight.rank),
    });
  } else if (insight.type === "leading" && insight.target) {
    main = line("insight_leading", {
      amount: amount(insight.gap),
      name: insight.target.displayName,
    });
  } else if (insight.type === "outside") {
    main = line(hasDeadline ? "insight_outside_week" : "insight_outside", {
      amount: amount(insight.gap),
      rank: numberFormatter.format(insight.lastRank),
    });
  } else if (insight.type === "behind") {
    main = line(hasDeadline ? "insight_behind_week" : "insight_behind", {
      amount: amount(insight.gap),
      name: insight.target.displayName,
      rank: numberFormatter.format(insight.targetRank),
    });

    if (insight.next) {
      detail = line(`insight_next_${insight.next.goal}`, {
        amount: amount(insight.next.gap),
      });
    }
  }

  return (
    <section className="leaderboards__insight">
      <span className="leaderboards__insight-icon">
        <StarIcon size={24} />
      </span>
      <div className="leaderboards__insight-text">
        <p>{main}</p>
        {detail && <small>{detail}</small>}
      </div>
    </section>
  );
}
