import { useMemo } from "react";
import cn from "classnames";
import { PeopleIcon } from "@primer/octicons-react";
import Skeleton from "react-loading-skeleton";
import { useTranslation } from "react-i18next";

import { Avatar, Button } from "@renderer/components";
import type { LeaderboardUser } from "../game-details/leaderboard/game-leaderboard";
import {
  buildHeatmap,
  getViewerRanking,
  normalizeFriendStreaks,
  normalizePlayActivity,
  PLAY_ACTIVITY_WEEKS,
  SECONDS_PER_HOUR,
  type GlobalLeaderboardMetric,
  type GlobalLeaderboardPeriod,
  type HeatmapCell,
} from "./global-leaderboard";
import { useApiResource } from "./leaderboards-api";
import {
  BlockError,
  BlockMessage,
  RankDelta,
  StreakFlame,
} from "./leaderboard-bits";
import { MetricIcon } from "./metric-icon";
import type { GlobalBoardResults } from "./use-global-leaderboards";

export interface StatsTabProps {
  results: GlobalBoardResults;
  metrics: GlobalLeaderboardMetric[];
  period: GlobalLeaderboardPeriod;
  viewerUser: LeaderboardUser | null;
  onOpenMetric: (metric: GlobalLeaderboardMetric) => void;
}

const DAY_LABEL_DATES = [5, 6, 7, 8, 9, 10, 11].map(
  (day) => new Date(Date.UTC(2024, 1, day))
);

export function StatsTab({
  results,
  metrics,
  period,
  viewerUser,
  onOpenMetric,
}: StatsTabProps) {
  const { t, i18n } = useTranslation("leaderboards");
  const viewerId = viewerUser?.id ?? null;
  const isWeek = period === "week";

  const activity = useApiResource(
    "/users/me/play-activity",
    { params: { weeks: PLAY_ACTIVITY_WEEKS }, needsAuth: true },
    normalizePlayActivity
  );
  const friends = useApiResource(
    "/users/me/friends/streaks",
    { params: {}, needsAuth: true },
    normalizeFriendStreaks
  );

  const heatmap = useMemo(
    () => buildHeatmap(activity.data?.days ?? [], Date.now()),
    [activity.data]
  );

  const dayLabels = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(i18n.language, {
      weekday: "narrow",
      timeZone: "UTC",
    });
    return DAY_LABEL_DATES.map((date) => formatter.format(date));
  }, [i18n.language]);

  const cellTitle = (cell: HeatmapCell) => {
    const date = new Intl.DateTimeFormat(i18n.language, {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(cell.date);
    const label = cell.isToday ? t("today_date", { date }) : date;
    const hours = Math.floor(cell.seconds / SECONDS_PER_HOUR);
    const minutes = Math.round((cell.seconds % SECONDS_PER_HOUR) / 60);
    let time = t("not_played");
    if (cell.seconds > 0) {
      time =
        hours > 0
          ? t("duration_hours_minutes", { hours, minutes })
          : t("duration_minutes", { minutes });
    }

    return [label, time, cell.games.join(", ")].filter(Boolean).join(" · ");
  };

  const atRecord =
    activity.data !== null &&
    activity.data.currentStreak > 0 &&
    activity.data.currentStreak >= activity.data.bestStreak;

  const renderStreak = () => {
    if (activity.isLoading && !activity.data) {
      return <Skeleton height={220} className="leaderboards__block-skeleton" />;
    }
    if (activity.hasError || !activity.data) {
      return <BlockError onRetry={activity.retry} />;
    }

    return (
      <>
        <div className="leaderboards__streak-numbers">
          <div className="leaderboards__streak-number">
            <span className="leaderboards__streak-label">
              {t("streak_current")}
            </span>
            <span className="leaderboards__streak-value">
              <strong>{activity.data.currentStreak}</strong>
              {t("days_unit", { count: activity.data.currentStreak })}
            </span>
          </div>
          <div className="leaderboards__streak-number">
            <span className="leaderboards__streak-label">
              {t("streak_best")}
            </span>
            <span className="leaderboards__streak-value">
              <strong>{activity.data.bestStreak}</strong>
              {t("days_unit", { count: activity.data.bestStreak })}
            </span>
          </div>
        </div>

        <div className="leaderboards__heatmap-block">
          <div className="leaderboards__heatmap-header">
            <span className="leaderboards__heatmap-title">
              {t("last_weeks", { count: PLAY_ACTIVITY_WEEKS })}
            </span>
            <span className="leaderboards__heatmap-legend">
              {t("legend_min")}
              {[0, 1, 2, 3].map((level) => (
                <span
                  key={level}
                  className={`leaderboards__heat leaderboards__heat--${level}`}
                />
              ))}
              {t("legend_max")}
            </span>
          </div>
          <div className="leaderboards__heatmap">
            {dayLabels.map((label, index) => (
              <span key={index} className="leaderboards__heatmap-day">
                {label}
              </span>
            ))}
            {heatmap.map((cell) => (
              <span
                key={cell.date.toISOString()}
                title={cell.isFuture ? undefined : cellTitle(cell)}
                className={cn(
                  "leaderboards__heat",
                  `leaderboards__heat--${cell.level}`,
                  {
                    "leaderboards__heat--future": cell.isFuture,
                    "leaderboards__heat--today": cell.isToday,
                  }
                )}
              />
            ))}
          </div>
        </div>
      </>
    );
  };

  const renderFriends = () => {
    if (friends.isLoading && !friends.data) {
      return (
        <div className="leaderboards__friend-streaks">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="leaderboards__friend-skeleton" />
          ))}
        </div>
      );
    }
    if (friends.hasError || !friends.data) {
      return <BlockError onRetry={friends.retry} />;
    }

    const others = friends.data.filter((item) => item.user.id !== viewerId);
    if (others.length === 0) {
      return (
        <BlockMessage
          icon={<PeopleIcon size={20} />}
          title={t("empty_friends_title")}
          description={t("empty_friend_streaks_description")}
          action={
            <Button
              theme="outline"
              size="small"
              onClick={() => globalThis.window.electron.openFriendsWindow()}
            >
              {t("find_friends")}
            </Button>
          }
        />
      );
    }

    return (
      <>
        <div className="leaderboards__friend-streaks">
          {friends.data.map((item) => (
            <div
              key={item.user.id}
              className={cn("leaderboards__friend-streak", {
                "leaderboards__friend-streak--viewer":
                  item.user.id === viewerId,
              })}
            >
              <span className="leaderboards__friend-avatar">
                <Avatar
                  size={24}
                  src={item.user.profileImageUrl}
                  alt={item.user.displayName}
                />
                <span
                  className={cn("leaderboards__presence", {
                    "leaderboards__presence--online": item.online,
                  })}
                  aria-hidden="true"
                />
              </span>
              <span className="leaderboards__friend-text">
                <span className="leaderboards__friend-name">
                  {item.user.displayName}
                </span>
                <span className="leaderboards__friend-presence">
                  {t(item.online ? "online" : "offline")}
                </span>
              </span>
              <span className="leaderboards__friend-days">
                {item.active && (
                  <StreakFlame
                    size={14}
                    flicker={item.days > 0 && item.days === item.bestDays}
                    label={t("streak_active")}
                  />
                )}
                {t("days_count", { count: item.days })}
              </span>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="leaderboards__link leaderboards__link--padded"
          onClick={() => globalThis.window.electron.openFriendsWindow()}
        >
          {t("see_all_friends")}
        </button>
      </>
    );
  };

  return (
    <>
      <div className="leaderboards__stats-grid">
        <section className="leaderboards__mine" aria-labelledby="mine-title">
          <div
            className={cn("leaderboards__mine-header", {
              "leaderboards__mine-header--banner":
                viewerUser?.backgroundImageUrl,
            })}
            style={
              viewerUser?.backgroundImageUrl
                ? ({
                    "--mine-banner": `url(${JSON.stringify(viewerUser.backgroundImageUrl)})`,
                  } as React.CSSProperties)
                : undefined
            }
          >
            <Avatar
              size={48}
              src={viewerUser?.profileImageUrl}
              alt={viewerUser?.displayName}
            />
            <div className="leaderboards__mine-heading">
              <h2 id="mine-title" className="leaderboards__mine-title">
                {t(isWeek ? "mine_week_title" : "mine_all_title")}
              </h2>
              <span className="leaderboards__mine-name">
                {viewerUser?.displayName}
              </span>
            </div>
          </div>
          <ul className="leaderboards__mine-list">
            {metrics.map((metric) => {
              const result = results[metric];
              const ranking = getViewerRanking(result.leaderboard, viewerId);

              return (
                <li key={metric}>
                  <button
                    type="button"
                    className="leaderboards__mine-row"
                    onClick={() => onOpenMetric(metric)}
                  >
                    <MetricIcon metric={metric} />
                    <span className="leaderboards__mine-label">
                      {t(`metric_${metric}`)}
                    </span>
                    {result.isLoading && !result.leaderboard ? (
                      <Skeleton width={48} />
                    ) : (
                      <>
                        <span className="leaderboards__mine-delta">
                          {isWeek && ranking && (
                            <RankDelta delta={ranking.delta} />
                          )}
                        </span>
                        <span className="leaderboards__mine-rank">
                          {ranking ? t("ordinal", { rank: ranking.rank }) : "–"}
                        </span>
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="leaderboards__panel" aria-labelledby="streak-title">
          <div className="leaderboards__panel-title">
            <StreakFlame size={16} flicker={atRecord} />
            <h2 id="streak-title" className="leaderboards__heading-3">
              {t("daily_streak")}
            </h2>
          </div>
          {renderStreak()}
        </section>
      </div>

      <section className="leaderboards__panel">
        <h2 className="leaderboards__heading-3">{t("friends_streak")}</h2>
        {renderFriends()}
      </section>
    </>
  );
}
