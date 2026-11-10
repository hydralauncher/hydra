import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import cn from "classnames";
import { PeopleIcon } from "@primer/octicons-react";
import Skeleton from "react-loading-skeleton";
import { useTranslation } from "react-i18next";

import { Avatar, Button } from "@renderer/components";
import { LEADERBOARD_HEADER_BANNER_IMAGE_SIZE } from "@renderer/constants";
import { useFormat, useProcessedImage } from "@renderer/hooks";
import type { LeaderboardUser } from "../game-details/leaderboard/game-leaderboard";
import {
  buildHeatmap,
  buildHeatmapMonths,
  DAY_MS,
  DAYS_PER_WEEK,
  getHeatmapLayout,
  getHeatmapTotalDisplay,
  getViewerRanking,
  normalizeFriendStreaks,
  normalizePlayActivity,
  PLAY_ACTIVITY_FALLBACK_WEEKS,
  PLAY_ACTIVITY_WEEKS,
  MINUTES_PER_HOUR,
  SECONDS_PER_MINUTE,
  sumHeatmap,
  type MetricDefinition,
  type GlobalLeaderboardPeriod,
  type HeatmapCell,
} from "./global-leaderboard";
import { requestAddFriendMode } from "../friends-window/add-friend-request";
import { useApiResource } from "./leaderboards-api";
import { BlockError, BlockMessage } from "./leaderboard-bits";
import {
  FRIEND_STREAK_PAGE_SIZE,
  FriendStreakList,
} from "./friend-streak-list";
import { MetricIcon } from "./metric-icon";
import {
  EMPTY_BOARD_RESULT,
  type GlobalBoardResults,
} from "./use-global-leaderboards";
import { useMetricText } from "./use-global-leaderboard-value";

const FRIEND_SKELETON_KEYS = Array.from(
  { length: FRIEND_STREAK_PAGE_SIZE },
  (_, index) => `friend-skeleton-${index}`
);

export interface StatsTabProps {
  results: GlobalBoardResults;
  metrics: MetricDefinition[];
  period: GlobalLeaderboardPeriod;
  viewerUser: LeaderboardUser | null;
  onOpenMetric: (metric: string) => void;
  onRetry: () => void;
}

// Mondays to Sundays; only Monday, Wednesday and Friday get a label.
const DAY_LABEL_DATES = [5, 6, 7, 8, 9, 10, 11].map(
  (day) => new Date(Date.UTC(2024, 1, day))
);
const LABELED_DAYS = new Set([0, 2, 4]);
const ACTIVITY_PARAMS = { weeks: PLAY_ACTIVITY_WEEKS };
// TODO: remove once hydra-api fix/epic-game-leaderboard is deployed.
// Older APIs answer 400 above 26 weeks; the grid then shows only those.
const ACTIVITY_FALLBACK = {
  options: {
    params: { weeks: PLAY_ACTIVITY_FALLBACK_WEEKS },
    needsAuth: true,
  },
  normalize: (response: unknown) =>
    normalizePlayActivity(response, PLAY_ACTIVITY_FALLBACK_WEEKS),
};
// Tips closer than this to an edge of the graph open inward.
const HEAT_TIP_EDGE_PX = 150;
const HEAT_TIP_GAP_PX = 6;

// Month and weekday names are lower case in some locales (pt-BR "nov.").
const capitalize = (text: string, locale: string) =>
  text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);

interface HeatTip {
  index: number;
  x: number;
  y: number;
  below: boolean;
  start: boolean;
  end: boolean;
}

function useUtcDay() {
  const [day, setDay] = useState(
    () => Math.floor(Date.now() / DAY_MS) * DAY_MS
  );

  useEffect(() => {
    const timeout = setTimeout(
      () => setDay(Math.floor(Date.now() / DAY_MS) * DAY_MS),
      day + DAY_MS - Date.now() + 1000
    );
    return () => clearTimeout(timeout);
  }, [day]);

  return day;
}

export function StatsTab({
  results,
  metrics,
  period,
  viewerUser,
  onOpenMetric,
  onRetry,
}: Readonly<StatsTabProps>) {
  const { t, i18n } = useTranslation("leaderboards");
  const { numberFormatter } = useFormat();
  const metricText = useMetricText();
  const viewerId = viewerUser?.id ?? null;
  const isWeek = period === "week";
  const banner = useProcessedImage(
    viewerUser?.backgroundImageUrl,
    LEADERBOARD_HEADER_BANNER_IMAGE_SIZE
  );

  const activity = useApiResource(
    "/users/me/play-activity",
    { params: ACTIVITY_PARAMS, needsAuth: true },
    normalizePlayActivity,
    ACTIVITY_FALLBACK
  );
  const friends = useApiResource(
    "/users/me/friends/streaks",
    { params: {}, needsAuth: true },
    normalizeFriendStreaks
  );

  const utcDay = useUtcDay();
  const hasFailedRanking = metrics.some((metric) => {
    const result = results[metric.id];
    return Boolean(
      result && !result.isLoading && result.hasError && !result.leaderboard
    );
  });

  const heatmap = useMemo(
    () =>
      buildHeatmap(
        activity.data?.days ?? [],
        utcDay,
        activity.data?.weeks ?? PLAY_ACTIVITY_WEEKS
      ),
    [activity.data, utcDay]
  );

  const hasActivity = activity.data !== null;
  const activityAreaRef = useRef<HTMLDivElement>(null);
  const [activityWidth, setActivityWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const area = activityAreaRef.current;
    if (!hasActivity || !area) return;
    setActivityWidth(area.clientWidth);

    const observer = new ResizeObserver(() =>
      setActivityWidth(area.clientWidth)
    );
    observer.observe(area);
    return () => observer.disconnect();
  }, [hasActivity]);

  const heatmapLayout = getHeatmapLayout(
    activityWidth,
    heatmap.length / DAYS_PER_WEEK
  );
  // The newest weeks are the last ones, so a narrow card keeps the recent days.
  const visibleHeatmap = useMemo(
    () => heatmap.slice(-heatmapLayout.weeks * DAYS_PER_WEEK),
    [heatmap, heatmapLayout.weeks]
  );

  const heatmapMonths = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(i18n.language, {
      month: "short",
      timeZone: "UTC",
    });
    return buildHeatmapMonths(visibleHeatmap).map((month) => ({
      ...month,
      label: capitalize(formatter.format(month.date), i18n.language),
    }));
  }, [visibleHeatmap, i18n.language]);

  const heatmapTotal = useMemo(
    () => sumHeatmap(visibleHeatmap),
    [visibleHeatmap]
  );

  const dayLabels = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(i18n.language, {
      weekday: "short",
      timeZone: "UTC",
    });
    return DAY_LABEL_DATES.map((date, index) => ({
      key: date.toISOString(),
      label: LABELED_DAYS.has(index)
        ? capitalize(formatter.format(date), i18n.language)
        : "",
    }));
  }, [i18n.language]);

  const activityBodyRef = useRef<HTMLDivElement>(null);
  const [heatTip, setHeatTip] = useState<HeatTip | null>(null);

  const cellDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }),
    [i18n.language]
  );

  // Days are UTC, so in UTC-3 today's cell is already the next date from
  // 21:00 on. Naming today and yesterday avoids showing that date.
  const cellLabel = (cell: HeatmapCell) => {
    if (cell.isToday) return t("today");
    if (cell.isYesterday) return t("yesterday");
    return cellDateFormatter.format(cell.date);
  };

  const cellSummary = (cell: HeatmapCell) => {
    const totalMinutes = Math.max(
      1,
      Math.round(cell.seconds / SECONDS_PER_MINUTE)
    );
    const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
    const minutes = totalMinutes % MINUTES_PER_HOUR;
    let time = t("not_played");
    if (cell.seconds > 0) {
      time =
        hours > 0
          ? t("duration_hours_minutes", { hours, minutes })
          : t("duration_minutes", { minutes });
    }

    return [cellLabel(cell), time].join(" · ");
  };

  // Tips near the left and right edges open inward and tips in the top two
  // rows open below, so they stay in the card.
  const showHeatTip = (event: React.MouseEvent<HTMLDivElement>) => {
    // The gaps between cells keep the current tip; future cells hide it.
    const target = (event.target as HTMLElement).closest<HTMLElement>(
      ".leaderboards__heat"
    );
    const body = activityBodyRef.current;
    if (!target || !body) return;
    if (target.dataset.heatIndex === undefined) {
      setHeatTip(null);
      return;
    }

    const index = Number(target.dataset.heatIndex);
    if (heatTip?.index === index) return;

    const cell = target.getBoundingClientRect();
    const bounds = body.getBoundingClientRect();
    const x = cell.left - bounds.left + cell.width / 2;
    const below = index % 7 < 2;

    setHeatTip({
      index,
      x,
      y: below
        ? cell.bottom - bounds.top + HEAT_TIP_GAP_PX
        : cell.top - bounds.top - HEAT_TIP_GAP_PX,
      below,
      start: x < HEAT_TIP_EDGE_PX,
      end: bounds.width - x < HEAT_TIP_EDGE_PX,
    });
  };

  const renderHeatTip = () => {
    const cell = heatTip ? visibleHeatmap[heatTip.index] : null;
    if (!heatTip || !cell || cell.isFuture) return null;

    return (
      <span
        className={cn("leaderboards__heat-tip", {
          "leaderboards__heat-tip--below": heatTip.below,
          "leaderboards__heat-tip--start": heatTip.start,
          "leaderboards__heat-tip--end": heatTip.end,
        })}
        style={{ left: heatTip.x, top: heatTip.y }}
        aria-hidden="true"
      >
        {cellSummary(cell)}
        {cell.games.map((game, index) => (
          <Fragment key={`${game}-${index}`}>
            {index === 0 ? " · " : ", "}
            <span className="leaderboards__heat-tip-game">{game}</span>
          </Fragment>
        ))}
      </span>
    );
  };

  // Current and best streak, in the Activity header.
  const renderStreak = () => {
    if (!activity.data) return null;

    return (
      <div className="leaderboards__activity-streaks">
        <span className="leaderboards__activity-streak">
          {t("streak_current")}
          <strong>{activity.data.currentStreak}</strong>
          {t("days_unit", { count: activity.data.currentStreak })}
        </span>
        <span className="leaderboards__activity-streak">
          {t("streak_best")}
          <strong>{activity.data.bestStreak}</strong>
          {t("days_unit", { count: activity.data.bestStreak })}
        </span>
      </div>
    );
  };

  const renderActivityTotal = () => {
    const total = getHeatmapTotalDisplay(heatmapTotal);
    if (total.unit === "none") return t("activity_empty");
    if (total.unit === "minutes") {
      return t("activity_total_minutes", {
        minutes: total.amount,
        count: heatmapTotal.days,
      });
    }

    return t("activity_total", {
      hours: numberFormatter.format(total.amount),
      count: heatmapTotal.days,
    });
  };

  const renderActivity = () => {
    if (activity.isLoading && !activity.data) {
      return <Skeleton height={150} className="leaderboards__block-skeleton" />;
    }
    if (activity.hasError || !activity.data) {
      return <BlockError onRetry={activity.retry} />;
    }

    return (
      <div className="leaderboards__activity-area" ref={activityAreaRef}>
        <div
          className="leaderboards__activity-body"
          ref={activityBodyRef}
          style={
            {
              "--heat-size": `${heatmapLayout.cellSize}px`,
              width: heatmapLayout.width,
            } as React.CSSProperties
          }
        >
          <div className="leaderboards__activity-graph">
            <div className="leaderboards__activity-months" aria-hidden="true">
              {heatmapMonths.map((month) => (
                <span
                  key={month.date.toISOString()}
                  className="leaderboards__activity-month"
                  style={{ gridColumnStart: month.week + 1 }}
                >
                  {month.label}
                </span>
              ))}
            </div>
            <div className="leaderboards__activity-days" aria-hidden="true">
              {dayLabels.map(({ key, label }) => (
                <span key={key} className="leaderboards__heatmap-day">
                  {label}
                </span>
              ))}
            </div>
            <div
              className="leaderboards__heatmap"
              onMouseMove={showHeatTip}
              onMouseLeave={() => setHeatTip(null)}
            >
              {visibleHeatmap.map((cell, index) => (
                <span
                  key={cell.date.toISOString()}
                  data-heat-index={cell.isFuture ? undefined : index}
                  role={cell.isFuture ? undefined : "img"}
                  aria-label={
                    cell.isFuture
                      ? undefined
                      : [cellSummary(cell), cell.games.join(", ")]
                          .filter(Boolean)
                          .join(" · ")
                  }
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
          {renderHeatTip()}
          <div className="leaderboards__activity-footer">
            <span>{renderActivityTotal()}</span>
            <span className="leaderboards__heatmap-legend">
              {t("legend_less")}
              {[0, 1, 2, 3].map((level) => (
                <span
                  key={level}
                  className={`leaderboards__heat leaderboards__heat--${level}`}
                />
              ))}
              {t("legend_more")}
            </span>
          </div>
        </div>
      </div>
    );
  };

  const hasNoFriendStreaks =
    friends.data?.every((item) => item.user.id === viewerId) ?? false;

  const renderFriends = () => {
    if (friends.isLoading && !friends.data) {
      return (
        <div className="leaderboards__friend-streaks">
          {FRIEND_SKELETON_KEYS.map((key) => (
            <Skeleton key={key} className="leaderboards__friend-skeleton" />
          ))}
        </div>
      );
    }
    if (friends.hasError || !friends.data) {
      return <BlockError onRetry={friends.retry} />;
    }

    if (hasNoFriendStreaks) {
      return (
        <BlockMessage
          icon={<PeopleIcon size={32} />}
          title={t("empty_friend_streaks_title")}
          description={t("empty_friend_streaks_description")}
          action={
            <Button
              theme="primary"
              onClick={() => {
                requestAddFriendMode();
                void globalThis.window.electron.openFriendsWindow();
              }}
            >
              {t("find_friends")}
            </Button>
          }
        />
      );
    }

    return (
      <FriendStreakList
        friends={friends.data.filter((item) => item.user.id !== viewerId)}
      />
    );
  };

  return (
    <>
      <div className="leaderboards__stats-grid">
        <section className="leaderboards__mine" aria-labelledby="mine-title">
          <div
            className={cn("leaderboards__mine-header", {
              "leaderboards__mine-header--banner": banner,
            })}
            style={
              banner
                ? ({
                    "--mine-banner": `url(${JSON.stringify(banner)})`,
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
          <div className="leaderboards__mine-body">
            <table className="leaderboards__mine-table">
              <thead>
                <tr>
                  <th scope="col">{t("metric_label")}</th>
                  <th scope="col">{t("column_value")}</th>
                  <th scope="col">{t("column_rank")}</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((metric) => {
                  const result = results[metric.id] ?? EMPTY_BOARD_RESULT;
                  const ranking = getViewerRanking(
                    result.leaderboard,
                    viewerId
                  );
                  const isPending = result.isLoading && !result.leaderboard;
                  const isFailed =
                    !result.isLoading && result.hasError && !result.leaderboard;
                  const placeholder = isPending ? "" : "–";

                  let value: React.ReactNode = placeholder;
                  if (isPending) value = <Skeleton width={48} />;
                  else if (isFailed) {
                    value = (
                      <span className="leaderboards__mine-error">
                        {t("leader_error")}
                      </span>
                    );
                  } else if (ranking) {
                    value = metricText.format(metric, ranking.value);
                  }

                  return (
                    <tr key={metric.id}>
                      <td>
                        <button
                          type="button"
                          className="leaderboards__mine-metric"
                          onClick={() => onOpenMetric(metric.id)}
                        >
                          <MetricIcon metric={metric.id} />
                          {metricText.label(metric)}
                        </button>
                      </td>
                      <td>{value}</td>
                      <td>
                        {ranking
                          ? t("ordinal", {
                              rank: numberFormatter.format(ranking.rank),
                            })
                          : placeholder}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {hasFailedRanking && (
            <div className="leaderboards__mine-retry">
              <Button theme="outline" size="small" onClick={onRetry}>
                {t("retry")}
              </Button>
            </div>
          )}
        </section>

        <section className="leaderboards__panel">
          {!hasNoFriendStreaks && (
            <h2 className="leaderboards__heading-3">{t("friends_streak")}</h2>
          )}
          {renderFriends()}
        </section>
      </div>

      <section
        className="leaderboards__panel leaderboards__activity"
        aria-labelledby="activity-title"
      >
        <div className="leaderboards__activity-header">
          <h2 id="activity-title" className="leaderboards__heading-3">
            {t("activity_title")}
          </h2>
          {renderStreak()}
        </div>
        {renderActivity()}
      </section>
    </>
  );
}
