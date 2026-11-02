import { useEffect, useState } from "react";
import cn from "classnames";
import { PeopleIcon, TrophyIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Button } from "@renderer/components";
import { buildGameDetailsPath } from "@renderer/helpers";
import type { GameShop } from "@types";
import { buildLeaderboardBoardPath } from "@shared";
import type { LeaderboardUser } from "../game-details/leaderboard/game-leaderboard";
import {
  buildMetricsRequest,
  getBoardState,
  GLOBAL_LEADERBOARD_TAKE,
  normalizeGlobalLeaderboardResponse,
  normalizeMetricDefinitions,
  type GlobalLeaderboardPeriod,
  type GlobalLeaderboardScope,
  type MyGameRanking,
} from "./global-leaderboard";
import { useApiResource } from "./leaderboards-api";
import { BoardHeader } from "./board-header";
import { BoardInsight } from "./board-insight";
import { BoardView } from "./board-view";
import { HeaderSelector } from "./header-selector";
import { MetricIcon } from "./metric-icon";
import { useGameIcon } from "./use-game-icon";
import {
  useMetricColumnLabel,
  useMetricText,
} from "./use-global-leaderboard-value";
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
  const metricColumnLabel = useMetricColumnLabel();
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

  const metricTabs = metric && (
    <HeaderSelector
      label={t("metric_label")}
      showLabel={false}
      collapsible
      value={metric.id}
      onChange={setRequestedMetric}
      options={gameMetrics.map((definition) => ({
        id: definition.id,
        label: metricText.label(definition),
        icon: <MetricIcon metric={definition.id} size={14} />,
      }))}
    />
  );

  const gameIcon = useGameIcon(boardGame?.shop, boardGame?.objectId);

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
      <>
        {metric && (
          <BoardInsight
            leaderboard={board.data}
            viewerId={viewerId}
            metric={metric}
            period={period}
          />
        )}
        <BoardView
          leaderboard={board.data}
          viewerUser={viewerUser}
          formatValue={formatValue}
          metricColumn={metric ? metricColumnLabel(metric) : ""}
          showDelta={isWeek}
          isLoading={board.isLoading}
          reportContext={
            metric && boardGame
              ? { metric: metric.id, window: period, scope, game: boardGame }
              : null
          }
        />
      </>
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
          <BoardHeader
            id="game-board-title"
            title={selected?.title ?? ""}
            description={
              metric
                ? t(`game_metric_description_${metric.id}`, {
                    defaultValue: "",
                  })
                : undefined
            }
            imageUrl={
              gameIcon === undefined
                ? null
                : (gameIcon ?? selected?.coverImageUrl ?? null)
            }
            onOpen={openGamePage}
            aside={!hasNoGameMetrics && metricTabs}
          />

          {renderBoard()}
        </section>
      )}
    </>
  );
}
