import { useState } from "react";
import cn from "classnames";
import Skeleton from "react-loading-skeleton";
import { useTranslation } from "react-i18next";

import { Button, RankFrameRing } from "@renderer/components";
import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import { useDate, useFormat } from "@renderer/hooks";
import {
  BADGES_PAGE_SIZE,
  buildMetricsRequest,
  getBadgeProgress,
  normalizeBadges,
  normalizeMetricDefinitions,
  type LeaderboardBadge,
  type MetricDefinition,
} from "./global-leaderboard";
import { getDurationParts } from "../game-details/leaderboard/game-leaderboard";
import { useApiResource } from "./leaderboards-api";
import { BlockError, StreakFlame } from "./leaderboard-bits";
import { useMetricText } from "./use-global-leaderboard-value";

const BADGE_SKELETON_ROWS = 6;
const BADGE_SKELETON_KEYS = Array.from(
  { length: BADGE_SKELETON_ROWS },
  (_, index) => `badge-skeleton-${index}`
);

export function BadgesSection() {
  const { t } = useTranslation("leaderboards");
  const { formatDate } = useDate();
  const { numberFormatter } = useFormat();
  const metricText = useMetricText();
  const globalMetricsRequest = buildMetricsRequest("global");
  const gameMetricsRequest = buildMetricsRequest("game");
  const globalMetrics = useApiResource(
    globalMetricsRequest.path,
    globalMetricsRequest.options,
    normalizeMetricDefinitions
  );
  const gameMetrics = useApiResource(
    gameMetricsRequest.path,
    gameMetricsRequest.options,
    normalizeMetricDefinitions
  );
  const findDefinition = (id: string): MetricDefinition | null =>
    [...(globalMetrics.data ?? []), ...(gameMetrics.data ?? [])].find(
      (definition) => definition.id === id
    ) ?? null;
  const findMetric = (id: string | null): MetricDefinition | null =>
    id ? (findDefinition(id) ?? { id, valueType: "count", label: id }) : null;
  const [expanded, setExpanded] = useState(false);

  const badges = useApiResource(
    "/users/me/leaderboard-badges",
    { params: {}, needsAuth: true },
    normalizeBadges
  );

  const metricLabel = (badge: LeaderboardBadge) => {
    const metric = findMetric(badge.metric);
    return metric ? metricText.label(metric) : "";
  };

  const getTitle = (badge: LeaderboardBadge) => {
    const game = badge.gameTitle ?? "";

    switch (badge.kind) {
      case "top_percent":
        return t("badge_top_percent", { percent: badge.value, game });
      case "weekly_leader":
        return t("badge_weekly_leader", { game });
      case "top_rank":
        return t("badge_top_rank", { rank: badge.value, game });
      case "friends_podium":
        return t("badge_friends_podium");
      case "streak_record":
        return t("badge_streak_record", { count: badge.value });
    }
  };

  const getSubtitle = (badge: LeaderboardBadge) => {
    const metric = metricLabel(badge);

    if (badge.kind === "streak_record") return t("badge_personal_record");
    if (badge.kind === "friends_podium") {
      return [badge.gameTitle, metric].filter(Boolean).join(" · ");
    }
    if (badge.kind === "weekly_leader") {
      if (!badge.earnedAt && badge.currentRank) {
        return `${metric} · ${t("you_are_at", { rank: badge.currentRank })}`;
      }
      if (badge.week)
        return `${metric} · ${t("week_number", { number: badge.week })}`;
    }

    const scopeLabel = t(`scope_${badge.scope}`);
    return `${metric} · ${scopeLabel}`;
  };

  const getChip = (badge: LeaderboardBadge) => {
    switch (badge.kind) {
      case "top_percent":
        return t("chip_top_percent", { percent: badge.value });
      case "top_rank":
        return badge.currentRank && badge.earnedAt
          ? `#${badge.currentRank}`
          : t("chip_top_rank", { rank: badge.value });
      case "streak_record":
        return t("chip_days", { count: badge.value });
      default:
        return t("ordinal", { rank: badge.value });
    }
  };

  const getMeta = (badge: LeaderboardBadge) => {
    if (badge.earnedAt) {
      return t(
        badge.kind === "weekly_leader" || badge.kind === "streak_record"
          ? "badge_earned_on"
          : "badge_since",
        { date: formatDate(badge.earnedAt) }
      );
    }
    if (!badge.progress) return "";

    const remaining = Math.max(
      0,
      badge.progress.target - badge.progress.current
    );
    if (!badge.metric) {
      return t("badge_remaining", {
        amount: numberFormatter.format(Math.ceil(remaining)),
      });
    }

    const metric = findDefinition(badge.metric);
    if (!metric) return "";
    const count = Math.ceil(remaining);
    // Boards show bare session counts; only the badge text names the unit.
    const amount = t(`badge_amount_${metric.id}`, {
      count,
      amount: numberFormatter.format(count),
      defaultValue: metricText.format(metric, count),
    });

    // "4 h to go for Top 10", "3 sessions to go for Top 5%". The count is the
    // number shown, so "1 h" and "1 session" read as singular.
    if (badge.target) {
      return t("badge_remaining_to", {
        context: badge.target.kind,
        count:
          metric.valueType === "duration"
            ? getDurationParts(count, MAX_MINUTES_TO_SHOW_IN_PLAYTIME).amount
            : count,
        amount,
        value: badge.target.value,
      });
    }

    return t("badge_remaining", { amount });
  };

  const renderBadge = (badge: LeaderboardBadge) => {
    const locked = !badge.earnedAt;
    const ring = !locked && badge.tier !== "streak";

    return (
      <div
        key={badge.id}
        className={cn(
          "leaderboards__badge",
          `leaderboards__badge--${badge.tier}`,
          {
            "leaderboards__badge--locked": locked,
            "leaderboards__badge--ring": ring,
            [`rank-frame rank-frame--${badge.tier}`]: ring,
          }
        )}
      >
        {ring && <RankFrameRing />}
        <div className="leaderboards__badge-art">
          <div
            className="leaderboards__badge-cover"
            style={
              badge.coverImageUrl
                ? ({
                    "--cover": `url(${JSON.stringify(badge.coverImageUrl)})`,
                  } as React.CSSProperties)
                : undefined
            }
          >
            {badge.kind === "streak_record" && (
              <StreakFlame size={24} gradient={!locked} />
            )}
          </div>
          <span className="leaderboards__badge-chip">{getChip(badge)}</span>
        </div>
        <div className="leaderboards__badge-body">
          <span className="leaderboards__badge-title">{getTitle(badge)}</span>
          <span className="leaderboards__badge-subtitle">
            {getSubtitle(badge)}
          </span>
          {locked ? (
            <div className="leaderboards__badge-progress">
              <span className="leaderboards__badge-bar" aria-hidden="true">
                <span style={{ width: `${getBadgeProgress(badge)}%` }} />
              </span>
              <span className="leaderboards__badge-meta">{getMeta(badge)}</span>
            </div>
          ) : (
            <span className="leaderboards__badge-meta leaderboards__badge-meta--earned">
              {getMeta(badge)}
            </span>
          )}
        </div>
      </div>
    );
  };

  const renderContent = () => {
    if (badges.isLoading && !badges.data) {
      return (
        <div className="leaderboards__badges">
          {BADGE_SKELETON_KEYS.map((key) => (
            <Skeleton key={key} className="leaderboards__badge-skeleton" />
          ))}
        </div>
      );
    }
    if (badges.hasError || !badges.data) {
      return <BlockError onRetry={badges.retry} />;
    }

    const list = expanded
      ? badges.data.badges
      : badges.data.badges.slice(0, BADGES_PAGE_SIZE);

    return (
      <>
        <div className="leaderboards__badges">{list.map(renderBadge)}</div>
        {!expanded && badges.data.badges.length > BADGES_PAGE_SIZE && (
          <div className="leaderboards__more">
            <Button theme="outline" onClick={() => setExpanded(true)}>
              {t("show_more")}
            </Button>
          </div>
        )}
      </>
    );
  };

  return (
    <section
      className="leaderboards__badges-section"
      aria-labelledby="badges-title"
    >
      <div className="leaderboards__section-header">
        <h2 id="badges-title" className="leaderboards__heading-2">
          {t("badges_title")}
        </h2>
        {badges.data && (
          <span className="leaderboards__board-count">
            {t("badges_count", {
              earned: badges.data.earned,
              total: badges.data.total,
            })}
          </span>
        )}
      </div>
      {renderContent()}
    </section>
  );
}
