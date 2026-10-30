import { useEffect, useState } from "react";
import cn from "classnames";
import { ClockIcon, PeopleIcon, StarIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Button } from "@renderer/components";
import { useDate, useFormat } from "@renderer/hooks";
import type {
  LeaderboardEntry,
  LeaderboardUser,
} from "../game-details/leaderboard/game-leaderboard";
import {
  formatBoardTotal,
  getBoardState,
  hasReviewData,
  type GlobalLeaderboardPeriod,
  type MetricDefinition,
  type GlobalLeaderboardScope,
  type LeaderboardReview,
} from "./global-leaderboard";
import { requestAddFriendMode } from "../friends-window/add-friend-request";
import { BoardHeader } from "./board-header";
import { BoardInsight } from "./board-insight";
import { BoardView } from "./board-view";
import { BlockError, BlockMessage, BoardSkeleton } from "./leaderboard-bits";
import { MetricIcon } from "./metric-icon";
import { ReviewHighlight } from "./review-highlight";
import type { ReportBoardContext } from "./report-cheater";
import {
  EMPTY_BOARD_RESULT,
  type GlobalBoardResults,
} from "./use-global-leaderboards";
import {
  useMetricColumnLabel,
  useMetricText,
} from "./use-global-leaderboard-value";
import { useReviewTranslation } from "./use-review-translation";

export interface RankingTabProps {
  results: GlobalBoardResults;
  metric: MetricDefinition | null;
  isMetricsLoading: boolean;
  hasMetricsError: boolean;
  period: GlobalLeaderboardPeriod;
  scope: GlobalLeaderboardScope;
  viewerUser: LeaderboardUser | null;
  onRetry: () => void;
  onPeriodChange: (period: GlobalLeaderboardPeriod) => void;
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
  metric,
  isMetricsLoading,
  hasMetricsError,
  period,
  scope,
  viewerUser,
  onRetry,
  onPeriodChange,
}: Readonly<RankingTabProps>) {
  const { t } = useTranslation("leaderboards");
  const navigate = useNavigate();
  const { numberFormatter } = useFormat();
  const metricText = useMetricText();
  const metricColumnLabel = useMetricColumnLabel();
  const [reviewerId, setReviewerId] = useState<string | null>(null);

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
          icon={<ClockIcon size={32} />}
          title={t(isWeek ? "empty_week_title" : "empty_all_title")}
          description={t(
            isWeek
              ? "empty_week_ranking_description"
              : "empty_all_ranking_description"
          )}
          action={
            isWeek ? (
              <Button theme="primary" onClick={() => onPeriodChange("all")}>
                {t("see_all_time")}
              </Button>
            ) : (
              <Button theme="primary" onClick={() => navigate("/library")}>
                {t("go_to_library")}
              </Button>
            )
          }
        />
      );
    }

    if (state === "empty_friends") {
      return (
        <BlockMessage
          icon={<PeopleIcon size={32} />}
          title={t("empty_friends_title")}
          description={t("empty_friends_ranking_description")}
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

    if (!leaderboard) return null;

    return (
      <>
        {metric && (
          <BoardInsight
            leaderboard={leaderboard}
            viewerId={viewerId}
            metric={metric}
            period={period}
          />
        )}
        <BoardView
          leaderboard={leaderboard}
          viewerUser={viewerUser}
          formatValue={format}
          showDelta={isWeek}
          isLoading={current.isLoading}
          selectedId={isReviews ? selectedReviewerId : undefined}
          onSelect={
            isReviews ? (entry) => setReviewerId(entry.user.id) : undefined
          }
          renderTooltip={isReviews ? renderReviewTooltip : undefined}
          belowPodium={renderSelectedReview()}
          metricColumn={metric ? metricColumnLabel(metric) : ""}
          reportContext={reportContext}
        />
      </>
    );
  };

  return (
    <>
      <section
        className={cn("leaderboards__board", {
          "leaderboards__board--empty":
            state === "empty" || state === "empty_friends",
        })}
        aria-labelledby="board-title"
      >
        <BoardHeader
          id="board-title"
          title={metric ? metricText.label(metric) : ""}
          description={
            metric
              ? t(`metric_description_${metric.id}`, { defaultValue: "" })
              : undefined
          }
          icon={metric && <MetricIcon metric={metric.id} size={20} />}
          aside={
            state === "ready" &&
            leaderboard && (
              <span className="leaderboards__board-count">
                {scope === "global" && leaderboard.total !== null
                  ? t("players_total", {
                      count: leaderboard.total,
                      total: formatBoardTotal(
                        leaderboard.total,
                        numberFormatter.format
                      ),
                    })
                  : t("players_count", { count: leaderboard.entries.length })}
              </span>
            )
          }
        />

        {renderBoard()}
      </section>
    </>
  );
}
