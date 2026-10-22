import { useEffect, useState } from "react";
import cn from "classnames";
import {
  ArrowRightIcon,
  ClockIcon,
  PeopleIcon,
  StarIcon,
  TrophyIcon,
} from "@primer/octicons-react";
import Skeleton from "react-loading-skeleton";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Avatar, Button } from "@renderer/components";
import { useDate, useFormat } from "@renderer/hooks";
import type {
  LeaderboardEntry,
  LeaderboardUser,
} from "../game-details/leaderboard/game-leaderboard";
import {
  getBoardState,
  GLOBAL_LEADERBOARD_PAGE_SIZE,
  type GlobalLeaderboardMetric,
  type GlobalLeaderboardPeriod,
  type GlobalLeaderboardScope,
  type LeaderboardReview,
} from "./global-leaderboard";
import { BoardView } from "./board-view";
import { BlockError, BlockMessage, BoardSkeleton } from "./leaderboard-bits";
import { MetricIcon } from "./metric-icon";
import type { GlobalBoardResults } from "./use-global-leaderboards";

export interface RankingTabProps {
  results: GlobalBoardResults;
  metrics: GlobalLeaderboardMetric[];
  metric: GlobalLeaderboardMetric;
  onMetricChange: (metric: GlobalLeaderboardMetric) => void;
  period: GlobalLeaderboardPeriod;
  scope: GlobalLeaderboardScope;
  viewerUser: LeaderboardUser | null;
  formatValue: (metric: GlobalLeaderboardMetric, value: number) => string;
  onRetry: () => void;
}

function ReviewScore({ review }: { review: LeaderboardReview }) {
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
  onMetricChange,
  period,
  scope,
  viewerUser,
  formatValue,
  onRetry,
}: RankingTabProps) {
  const { t } = useTranslation("leaderboards");
  const { numberFormatter } = useFormat();
  const navigate = useNavigate();
  const [reviewerId, setReviewerId] = useState<string | null>(null);

  const current = results[metric];
  const leaderboard = current.leaderboard;
  const isWeek = period === "week";
  const viewerId = viewerUser?.id ?? null;

  useEffect(() => {
    setReviewerId(null);
  }, [leaderboard]);

  const state = getBoardState({
    isLoading: current.isLoading,
    hasError: current.hasError,
    leaderboard,
    scope,
    viewerId,
  });

  const format = (value: number) => formatValue(metric, value);
  const isReviews = metric === "reviews";
  const leaderId = leaderboard?.entries[0]?.user.id ?? null;
  const selectedReviewerId = reviewerId ?? leaderId;
  const selectedEntry =
    leaderboard?.entries.find(
      (entry) => entry.user.id === selectedReviewerId
    ) ?? null;
  const selectedReview = selectedEntry
    ? (leaderboard?.extras[selectedEntry.user.id]?.review ?? null)
    : null;

  const renderLeaderCard = (id: GlobalLeaderboardMetric) => {
    const result = results[id];
    const leader = result.leaderboard?.entries[0] ?? null;

    let leaderContent: React.ReactNode = (
      <span className="leaderboards__card-empty">{t("no_leader")}</span>
    );

    if (result.isLoading && !result.leaderboard) {
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
              {formatValue(id, leader.value)}
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
        aria-selected={id === metric}
        className={cn("leaderboards__card", {
          "leaderboards__card--selected": id === metric,
        })}
        onClick={() => onMetricChange(id)}
      >
        <span className="leaderboards__card-label">
          <MetricIcon metric={id} />
          <span className="leaderboards__card-label-text">
            {t(`metric_${id}`)}
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
          <p className="leaderboards__review-tip-text">{review.text}</p>
        </div>
      </div>
    );
  };

  const renderSelectedReview = () => {
    if (!isReviews || !selectedEntry || !selectedReview) return null;

    const title =
      selectedEntry.user.id === leaderId
        ? t(isWeek ? "review_top_week" : "review_top_all")
        : t("review_top_of", { name: selectedEntry.user.displayName });

    return (
      <article className="leaderboards__review">
        <div className="leaderboards__review-header">
          <TrophyIcon size={16} />
          <span>{title}</span>
        </div>
        <div className="leaderboards__review-content">
          {selectedReview.coverImageUrl && (
            <img
              className="leaderboards__review-cover"
              src={selectedReview.coverImageUrl}
              alt={selectedReview.gameTitle}
            />
          )}
          <div className="leaderboards__review-body">
            <h3 className="leaderboards__review-game">
              {selectedReview.gameTitle}
            </h3>
            <div className="leaderboards__review-author">
              <Avatar
                size={28}
                src={selectedEntry.user.profileImageUrl}
                alt={selectedEntry.user.displayName}
              />
              <span className="leaderboards__review-name">
                {selectedEntry.user.displayName}
              </span>
              <ReviewScore review={selectedReview} />
            </div>
            <p
              className="leaderboards__review-text"
              title={selectedReview.text}
            >
              {selectedReview.text}
            </p>
            <div className="leaderboards__review-footer">
              <span className="leaderboards__review-votes">
                <MetricIcon metric="reviews" size={14} />
                {format(selectedEntry.value)}
              </span>
              <button
                type="button"
                className="leaderboards__link"
                onClick={() =>
                  navigate(
                    `/game/${selectedReview.shop}/${selectedReview.objectId}`
                  )
                }
              >
                {t("review_open_game", { game: selectedReview.gameTitle })}
                <ArrowRightIcon size={14} />
              </button>
            </div>
          </div>
        </div>
      </article>
    );
  };

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
          isStreak={metric === "streak"}
          isLoading={current.isLoading}
          selectedId={isReviews ? selectedReviewerId : undefined}
          onSelect={
            isReviews ? (entry) => setReviewerId(entry.user.id) : undefined
          }
          renderTooltip={isReviews ? renderReviewTooltip : undefined}
        />
      </>
    );
  };

  const visibleCount = leaderboard
    ? Math.min(leaderboard.entries.length, GLOBAL_LEADERBOARD_PAGE_SIZE)
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
          {metrics.map(renderLeaderCard)}
        </div>
      </section>

      <section className="leaderboards__board" aria-labelledby="board-title">
        <div className="leaderboards__board-header">
          <MetricIcon metric={metric} size={20} />
          <h2 id="board-title" className="leaderboards__board-title">
            {t(`metric_${metric}`)}
          </h2>
          {state === "ready" && leaderboard && (
            <span className="leaderboards__board-count">
              {scope === "global" && leaderboard.total !== null
                ? t("top_of_total", {
                    count: visibleCount,
                    total: numberFormatter.format(leaderboard.total),
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
