import { useEffect, useState } from "react";
import cn from "classnames";
import {
  LinkExternalIcon,
  PeopleIcon,
  TrophyIcon,
} from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Button } from "@renderer/components";
import { useFormat } from "@renderer/hooks";
import { buildGameDetailsPath } from "@renderer/helpers";
import type { GameShop } from "@types";
import { buildLeaderboardBoardPath } from "@shared";
import type { LeaderboardUser } from "../game-details/leaderboard/game-leaderboard";
import {
  buildMetricsRequest,
  formatBoardTotal,
  getBoardState,
  getViewerRanking,
  GLOBAL_LEADERBOARD_TAKE,
  normalizeGlobalLeaderboardResponse,
  normalizeMetricDefinitions,
  type GlobalLeaderboardPeriod,
  type GlobalLeaderboardScope,
  type MyGameRanking,
} from "./global-leaderboard";
import { useApiResource } from "./leaderboards-api";
import { BoardView } from "./board-view";
import { useMetricText } from "./use-global-leaderboard-value";
import { BlockError, BlockMessage, BoardSkeleton } from "./leaderboard-bits";

export interface LinkedGame {
  shop: string;
  objectId: string;
}

export interface ByGameTabProps {
  period: GlobalLeaderboardPeriod;
  scope: GlobalLeaderboardScope;
  viewerUser: LeaderboardUser | null;
  initialGame?: LinkedGame | null;
  initialMetric?: string | null;
  games: MyGameRanking[];
  selectedKey: string | null;
  onScopeChange: (scope: GlobalLeaderboardScope) => void;
  onPeriodChange: (period: GlobalLeaderboardPeriod) => void;
}

interface SelectedGame {
  shop: string;
  objectId: string;
  title: string;
  coverImageUrl: string | null;
  heroImageUrl: string | null;
  rank: number | null;
  total: number | null;
}

const backgroundStyle = (url: string | null, variable: string) =>
  url
    ? ({ [variable]: `url(${JSON.stringify(url)})` } as React.CSSProperties)
    : undefined;

export const gameKey = (game: LinkedGame) => `${game.shop}:${game.objectId}`;

function useLinkedGameAssets(game: LinkedGame | null) {
  const [assets, setAssets] = useState<SelectedGame | null>(null);
  const shop = game?.shop ?? null;
  const objectId = game?.objectId ?? null;

  useEffect(() => {
    if (!shop || !objectId) {
      setAssets(null);
      return;
    }

    let cancelled = false;
    globalThis.window.electron
      .getGameAssets(objectId, shop as GameShop)
      .then((result) => {
        if (cancelled || !result) return;
        setAssets({
          shop,
          objectId,
          title: result.title,
          coverImageUrl: result.coverImageUrl,
          heroImageUrl: result.libraryHeroImageUrl,
          rank: null,
          total: null,
        });
      })
      .catch(() => {
        if (!cancelled) setAssets(null);
      });

    return () => {
      cancelled = true;
    };
  }, [objectId, shop]);

  return assets?.shop === shop && assets.objectId === objectId ? assets : null;
}

export function ByGameTab({
  period,
  scope,
  viewerUser,
  initialGame = null,
  initialMetric = null,
  games,
  selectedKey,
  onScopeChange,
  onPeriodChange,
}: Readonly<ByGameTabProps>) {
  const { t } = useTranslation("leaderboards");
  const navigate = useNavigate();
  const metricText = useMetricText();
  const { numberFormatter } = useFormat();
  const [requestedMetric, setRequestedMetric] = useState<string | null>(
    initialMetric
  );
  const metricsRequest = buildMetricsRequest("game");
  const metricDefinitions = useApiResource(
    metricsRequest.path,
    metricsRequest.options,
    normalizeMetricDefinitions
  );
  const gameMetrics = metricDefinitions.data ?? [];
  const hasNoGameMetrics =
    !metricDefinitions.isLoading &&
    !metricDefinitions.hasError &&
    metricDefinitions.data?.length === 0;
  const metric =
    gameMetrics.find((definition) => definition.id === requestedMetric) ??
    gameMetrics[0] ??
    null;

  const listed = games.find((game) => gameKey(game) === selectedKey);
  const linkedGame =
    initialGame && selectedKey === gameKey(initialGame) && !listed
      ? initialGame
      : null;
  const linkedAssets = useLinkedGameAssets(linkedGame);
  const boardGame: LinkedGame | null = listed ?? linkedGame ?? games[0] ?? null;
  const selected: SelectedGame | MyGameRanking | null =
    listed ?? linkedAssets ?? (linkedGame ? null : (games[0] ?? null));

  const board = useApiResource(
    boardGame && metric
      ? buildLeaderboardBoardPath(metric.id, boardGame)
      : null,
    {
      params: { range: period, scope, take: GLOBAL_LEADERBOARD_TAKE },
      needsAuth: true,
    },
    normalizeGlobalLeaderboardResponse
  );

  const isWeek = period === "week";
  const viewerId = viewerUser?.id ?? null;
  const boardState = getBoardState({
    isLoading: board.isLoading || metricDefinitions.isLoading,
    hasError: board.hasError || metricDefinitions.hasError,
    leaderboard: board.data,
    scope,
    viewerId,
  });

  const formatValue = (value: number) =>
    metric ? metricText.format(metric, value) : String(value);

  const viewerRanking = getViewerRanking(board.data, viewerId);
  const heroRank = board.data
    ? (viewerRanking?.rank ?? null)
    : (selected?.rank ?? null);
  const heroTotal = board.data
    ? (board.data.total ?? null)
    : (selected?.total ?? null);
  let heroSubtitle = "";
  if (heroRank !== null && heroTotal !== null) {
    heroSubtitle = t("game_ranking_subtitle", {
      total: formatBoardTotal(heroTotal, numberFormatter.format),
      rank: heroRank,
    });
  } else if (heroRank !== null) {
    heroSubtitle = t("you_are_at", { rank: heroRank });
  } else if (heroTotal !== null) {
    heroSubtitle = t("players_count", { count: heroTotal });
  }

  const metricChips = (
    <fieldset className="leaderboards__chips">
      <legend className="leaderboards__sr-only">{t("metric_label")}</legend>
      {gameMetrics.map((definition) => (
        <button
          key={definition.id}
          type="button"
          aria-pressed={definition.id === metric?.id}
          className={cn("leaderboards__chip", {
            "leaderboards__chip--selected": definition.id === metric?.id,
          })}
          onClick={() => setRequestedMetric(definition.id)}
        >
          {metricText.label(definition)}
        </button>
      ))}
    </fieldset>
  );

  const openGamePage = () => {
    if (!boardGame) return;

    navigate(
      buildGameDetailsPath({
        shop: boardGame.shop as GameShop,
        objectId: boardGame.objectId,
        title: selected?.title ?? "",
      })
    );
  };

  const isBoardEmpty =
    hasNoGameMetrics ||
    boardState === "empty" ||
    boardState === "empty_friends";

  const renderBoard = () => {
    if (hasNoGameMetrics) {
      return (
        <BlockMessage
          icon={<TrophyIcon size={32} />}
          title={t("game_metrics_empty_title")}
          description={t("game_metrics_empty_description")}
        />
      );
    }

    if (boardState === "loading") return <BoardSkeleton />;
    if (boardState === "error") {
      return (
        <BlockError
          onRetry={() => {
            metricDefinitions.retry();
            board.retry();
          }}
        />
      );
    }

    if (boardState === "empty") {
      return (
        <BlockMessage
          icon={<TrophyIcon size={32} />}
          title={t(isWeek ? "empty_week_title" : "empty_all_title")}
          description={t(
            isWeek
              ? "empty_week_game_description"
              : "empty_all_game_description"
          )}
          action={
            isWeek ? (
              <Button theme="primary" onClick={() => onPeriodChange("all")}>
                {t("see_all_time")}
              </Button>
            ) : (
              <Button theme="primary" onClick={openGamePage}>
                {t("open_game_page")}
              </Button>
            )
          }
        />
      );
    }

    if (boardState === "empty_friends") {
      return (
        <BlockMessage
          icon={<PeopleIcon size={32} />}
          title={t("empty_friends_game_title")}
          description={t("empty_friends_game_description")}
          action={
            <Button theme="primary" onClick={() => onScopeChange("global")}>
              {t("see_global_ranking")}
            </Button>
          }
        />
      );
    }

    if (!board.data || !boardGame) return null;

    return (
      <BoardView
        leaderboard={board.data}
        viewerUser={viewerUser}
        formatValue={formatValue}
        leaderLabel={t(isWeek ? "leader_of_week" : "record_holder")}
        showDelta={isWeek}
        isLoading={board.isLoading}
        reportContext={
          metric && boardGame
            ? { metric: metric.id, window: period, scope, game: boardGame }
            : null
        }
      />
    );
  };

  return (
    <>
      {boardGame && (
        <section
          className={cn("leaderboards__board leaderboards__board--game", {
            "leaderboards__board--empty": isBoardEmpty,
          })}
          aria-labelledby="game-board-title"
        >
          <div
            className={cn("leaderboards__hero", {
              "leaderboards__hero--image": selected?.heroImageUrl,
            })}
            style={backgroundStyle(selected?.heroImageUrl ?? null, "--hero")}
          >
            <span
              className="leaderboards__hero-cover"
              style={backgroundStyle(
                selected?.coverImageUrl ?? null,
                "--cover"
              )}
            />
            <div className="leaderboards__hero-text">
              <h2 id="game-board-title" className="leaderboards__hero-title">
                {t("game_ranking_title", { game: selected?.title ?? "" })}
              </h2>
              <span className="leaderboards__hero-subtitle">
                {heroSubtitle}
              </span>
            </div>
            <button
              type="button"
              className="leaderboards__hero-link"
              onClick={openGamePage}
            >
              {t("open_game_page")}
              <LinkExternalIcon size={14} />
            </button>
          </div>

          {!hasNoGameMetrics && metricChips}
          {renderBoard()}
        </section>
      )}
    </>
  );
}
