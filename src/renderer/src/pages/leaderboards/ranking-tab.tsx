import { useEffect, useState } from "react";
import cn from "classnames";
import { ClockIcon, PeopleIcon, StarIcon } from "@primer/octicons-react";
import Skeleton from "react-loading-skeleton";
import { useTranslation } from "react-i18next";

import { Avatar, Button } from "@renderer/components";
import { useDate, useFormat } from "@renderer/hooks";
import type {
  LeaderboardEntry,
  LeaderboardUser,
} from "../game-details/leaderboard/game-leaderboard";
import {
  formatBoardTotal,
  getBoardState,
  GLOBAL_LEADERBOARD_PAGE_SIZE,
  hasReviewData,
  hasStreakData,
  type GlobalLeaderboardPeriod,
  type MetricDefinition,
  type GlobalLeaderboardScope,
  type LeaderboardReview,
} from "./global-leaderboard";
import { BoardView } from "./board-view";
import { BlockError, BlockMessage, BoardSkeleton } from "./leaderboard-bits";
import { MetricIcon } from "./metric-icon";
import { ReviewHighlight } from "./review-highlight";
import type { ReportBoardContext } from "./report-cheater";
import {
  EMPTY_BOARD_RESULT,
  type GlobalBoardResults,
} from "./use-global-leaderboards";
import { useMetricText } from "./use-global-leaderboard-value";
import { useReviewTranslation } from "./use-review-translation";

const METRIC_CARD_PLACEHOLDERS = Array.from(
  { length: 8 },
  (_, position) => `metric-placeholder-${position}`
);

export interface RankingTabProps {
  results: GlobalBoardResults;
  metrics: MetricDefinition[];
  metric: MetricDefinition | null;
  isMetricsLoading: boolean;
  hasMetricsError: boolean;
  onMetricChange: (metric: string) => void;
  period: GlobalLeaderboardPeriod;
  scope: GlobalLeaderboardScope;
  viewerUser: LeaderboardUser | null;
  onRetry: () => void;
}

// Outside the component to keep it under the cognitive complexity limit.
const getReportContext = (
  metric: MetricDefinition | null,
  period: GlobalLeaderboardPeriod,
  scope: GlobalLeaderboardScope
): ReportBoardContext | null =>
  metric ? { metric: metric.id, window: period, scope } : null;

// Tooltip text in the app language when the API sent a translation.
function ReviewTipText({
  review,
  authorId,
}: Readonly<{ review: LeaderboardReview; authorId: string }>) {
  const { translatedHtml } = useReviewTranslation(review, authorId);

  // A div: the translation is HTML and may carry its own <p>.
  if (translatedHtml) {
    return (
      <div
        className="leaderboards__review-tip-text"
        dangerouslySetInnerHTML={{ __html: translatedHtml }}
      />
    );
  }

  return <p className="leaderboards__review-tip-text">{review.text}</p>;
}

function ReviewScore({ review }: Readonly<{ review: LeaderboardReview }>) {
  const { t } = useTranslation("leaderboards");
  const { formatDistance } = useDate();
  const distance = review.createdAt
    ? formatDistance(review.createdAt, new Date(), { addSuffix: true })
    : "";

  return (
    <span className="leaderboards__review-score">
      <StarIcon size={12} />
      {t("review_score", { score: review.score })}
      {distance && ` · ${distance.charAt(0).toUpperCase()}${distance.slice(1)}`}
    </span>
  );
}

export function RankingTab({
  results,
  metrics,
  metric,
  isMetricsLoading,
  hasMetricsError,
  onMetricChange,
  period,
  scope,
  viewerUser,
  onRetry,
}: Readonly<RankingTabProps>) {
  const { t } = useTranslation("leaderboards");
  const { numberFormatter } = useFormat();
  const metricText = useMetricText();
  const [reviewerId, setReviewerId] = useState<string | null>(null);
  const [visibleRows, setVisibleRows] = useState(GLOBAL_LEADERBOARD_PAGE_SIZE);

  const current = (metric && results[metric.id]) || EMPTY_BOARD_RESULT;
  const leaderboard = current.leaderboard;
  const isWeek = period === "week";
  const viewerId = viewerUser?.id ?? null;

  useEffect(() => {
    setReviewerId(null);
  }, [leaderboard]);

  const state = getBoardState({
    isLoading: current.isLoading || isMetricsLoading,
    hasError: current.hasError || hasMetricsError,
    leaderboard,
    scope,
    viewerId,
  });

  const format = (value: number) =>
    metric ? metricText.format(metric, value) : String(value);
  const isReviews = hasReviewData(leaderboard);
  const leaderId = leaderboard?.entries[0]?.user.id ?? null;
  const selectedReviewerId = reviewerId ?? leaderId;
  const selectedEntry =
    leaderboard?.entries.find(
      (entry) => entry.user.id === selectedReviewerId
    ) ?? null;
  const selectedReview = selectedEntry
    ? (leaderboard?.extras[selectedEntry.user.id]?.review ?? null)
    : null;

  const renderLeaderCard = (definition: MetricDefinition) => {
    const { id } = definition;
    const result = results[id] ?? EMPTY_BOARD_RESULT;
    const leader = result.leaderboard?.entries[0] ?? null;

    let leaderContent: React.ReactNode = (
      <span className="leaderboards__card-empty">{t("no_leader")}</span>
    );

    if (result.hasError) {
      leaderContent = (
        <span className="leaderboards__card-empty">{t("leader_error")}</span>
      );
    } else if (result.isLoading && !result.leaderboard) {
      leaderContent = (
        <Skeleton className="leaderboards__card-skeleton" width="100%" />
      );
    } else if (leader) {
      leaderContent = (
        <>
          <Avatar
            size={28}
            src={leader.user.profileImageUrl}
            alt={leader.user.displayName}
          />
          <span className="leaderboards__card-leader-text">
            <span className="leaderboards__card-leader-name">
              {leader.user.displayName}
            </span>
            <span className="leaderboards__card-leader-value">
              {metricText.format(definition, leader.value)}
            </span>
          </span>
        </>
      );
    }

    return (
      <button
        key={id}
        type="button"
        role="tab"
        aria-selected={id === metric?.id}
        className={cn("leaderboards__card", {
          "leaderboards__card--selected": id === metric?.id,
        })}
        onClick={() => onMetricChange(id)}
      >
        <span className="leaderboards__card-label">
          <MetricIcon metric={id} />
          <span className="leaderboards__card-label-text">
            {metricText.label(definition)}
          </span>
        </span>
        <span className="leaderboards__card-leader">{leaderContent}</span>
      </button>
    );
  };

  const renderReviewTooltip = (entry: LeaderboardEntry) => {
    const review = leaderboard?.extras[entry.user.id]?.review;
    if (!isReviews || !review) return null;

    return (
      <div className="leaderboards__review-tip">
        {review.coverImageUrl && (
          <img
            className="leaderboards__review-tip-cover"
            src={review.coverImageUrl}
            alt=""
          />
        )}
        <div className="leaderboards__review-tip-body">
          <span className="leaderboards__review-tip-game">
            {review.gameTitle}
          </span>
          <ReviewScore review={review} />
          <ReviewTipText review={review} authorId={entry.user.id} />
        </div>
      </div>
    );
  };

  const renderSelectedReview = () => {
    if (!isReviews || !selectedEntry || !selectedReview) return null;

    const topTitle = t(isWeek ? "review_top_week" : "review_top_all");
    const title =
      selectedEntry.user.id === leaderId
        ? topTitle
        : t("review_top_of", { name: selectedEntry.user.displayName });

    return (
      <ReviewHighlight
        title={title}
        entry={selectedEntry}
        review={selectedReview}
      />
    );
  };

  const reportContext = getReportContext(metric, period, scope);

  const renderBoard = () => {
    if (state === "loading") return <BoardSkeleton />;
    if (state === "error") return <BlockError onRetry={onRetry} />;

    if (state === "empty") {
      return (
        <BlockMessage
          icon={<ClockIcon size={24} />}
          title={t(isWeek ? "empty_week_title" : "empty_all_title")}
          description={t(
            isWeek ? "empty_week_description" : "empty_all_description"
          )}
        />
      );
    }

    if (state === "empty_friends") {
      return (
        <BlockMessage
          icon={<PeopleIcon size={24} />}
          title={t("empty_friends_title")}
          description={t("empty_friends_description")}
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

    if (!leaderboard) return null;

    return (
      <>
        {renderSelectedReview()}
        <BoardView
          leaderboard={leaderboard}
          viewerUser={viewerUser}
          formatValue={format}
          leaderLabel={t(isWeek ? "leader_of_week" : "record_holder")}
          showDelta={isWeek}
          isStreak={hasStreakData(leaderboard)}
          isLoading={current.isLoading}
          selectedId={isReviews ? selectedReviewerId : undefined}
          onSelect={
            isReviews ? (entry) => setReviewerId(entry.user.id) : undefined
          }
          renderTooltip={isReviews ? renderReviewTooltip : undefined}
          onVisibleChange={setVisibleRows}
          reportContext={reportContext}
        />
      </>
    );
  };

  const visibleCount = leaderboard
    ? Math.min(leaderboard.entries.length, visibleRows)
    : 0;

  return (
    <>
      <section className="leaderboards__leaders">
        <h2 className="leaderboards__section-title">
          {t(isWeek ? "leaders_title" : "leaders_all_title")}
        </h2>
        <div
          className="leaderboards__cards"
          role="tablist"
          aria-label={t("metric_label")}
        >
          {isMetricsLoading && metrics.length === 0
            ? METRIC_CARD_PLACEHOLDERS.map((placeholder) => (
                <Skeleton
                  key={placeholder}
                  className="leaderboards__card-placeholder"
                />
              ))
            : metrics.map(renderLeaderCard)}
        </div>
      </section>

      <section className="leaderboards__board" aria-labelledby="board-title">
        <div className="leaderboards__board-header">
          {metric && <MetricIcon metric={metric.id} size={20} />}
          <h2 id="board-title" className="leaderboards__board-title">
            {metric ? metricText.label(metric) : ""}
          </h2>
          {state === "ready" && leaderboard && (
            <span className="leaderboards__board-count">
              {scope === "global" && leaderboard.total !== null
                ? t("top_of_total", {
                    count: visibleCount,
                    total: formatBoardTotal(
                      leaderboard.total,
                      numberFormatter.format
                    ),
                  })
                : t("players_count", { count: leaderboard.entries.length })}
            </span>
          )}
        </div>

        {renderBoard()}
      </section>
    </>
  );
}
