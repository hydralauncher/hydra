import { useEffect, useMemo, useRef, useState } from "react";
import cn from "classnames";
import {
  LinkExternalIcon,
  PeopleIcon,
  SearchIcon,
  TrophyIcon,
  XIcon,
} from "@primer/octicons-react";
import Skeleton from "react-loading-skeleton";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Avatar } from "@renderer/components";
import { useFormat } from "@renderer/hooks";
import { buildGameDetailsPath } from "@renderer/helpers";
import type { GameShop } from "@types";
import { buildLeaderboardBoardPath } from "@shared";
import type { LeaderboardUser } from "../game-details/leaderboard/game-leaderboard";
import {
  buildMetricsRequest,
  formatBoardTotal,
  getBoardState,
  getRankDelta,
  getViewerRanking,
  GLOBAL_LEADERBOARD_TAKE,
  normalizeGlobalLeaderboardResponse,
  normalizeMetricDefinitions,
  normalizeMyGames,
  type GlobalLeaderboardPeriod,
  type GlobalLeaderboardScope,
  type MyGameRanking,
} from "./global-leaderboard";
import { useApiResource } from "./leaderboards-api";
import { BoardView } from "./board-view";
import { useMetricText } from "./use-global-leaderboard-value";
import {
  BlockError,
  BlockMessage,
  BoardSkeleton,
  RankDelta,
} from "./leaderboard-bits";

const GAME_SKELETON_ROWS = 4;
const GAME_SKELETON_KEYS = Array.from(
  { length: GAME_SKELETON_ROWS },
  (_, index) => `game-skeleton-${index}`
);

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

const gameKey = (game: LinkedGame) => `${game.shop}:${game.objectId}`;

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
}: Readonly<ByGameTabProps>) {
  const { t } = useTranslation("leaderboards");
  const navigate = useNavigate();
  const metricText = useMetricText();
  const { numberFormatter } = useFormat();
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(
    initialGame ? gameKey(initialGame) : null
  );
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

  const games = useApiResource(
    "/leaderboards/me/games",
    { params: { window: period, scope }, needsAuth: true },
    normalizeMyGames
  );

  const lastGamesRef = useRef(games.data);
  if (games.data) lastGamesRef.current = games.data;
  const shownGames =
    games.data ?? (games.isLoading ? lastGamesRef.current : null);
  const allGames = useMemo(() => shownGames ?? [], [shownGames]);
  const listed = allGames.find((game) => gameKey(game) === selectedKey);
  const linkedGame =
    initialGame && selectedKey === gameKey(initialGame) && !listed
      ? initialGame
      : null;
  const linkedAssets = useLinkedGameAssets(linkedGame);
  const boardGame: LinkedGame | null =
    listed ?? linkedGame ?? allGames[0] ?? null;
  const selected: SelectedGame | MyGameRanking | null =
    listed ?? linkedAssets ?? (linkedGame ? null : (allGames[0] ?? null));

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    if (!term) return allGames;

    return allGames.filter((game) =>
      game.title.toLocaleLowerCase().includes(term)
    );
  }, [allGames, search]);

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

  const renderGames = () => {
    if (games.isLoading && !games.data) {
      return (
        <div className="leaderboards__games">
          {GAME_SKELETON_KEYS.map((key) => (
            <Skeleton key={key} className="leaderboards__game-skeleton" />
          ))}
        </div>
      );
    }

    if (games.hasError) return <BlockError onRetry={games.retry} />;

    if (allGames.length === 0) {
      return (
        <BlockMessage
          icon={<TrophyIcon size={24} />}
          title={t("games_empty_title")}
          description={t("games_empty_description")}
        />
      );
    }

    if (filtered.length === 0 && search.trim()) {
      return <BlockMessage title={t("games_search_empty")} />;
    }

    return (
      <div className="leaderboards__games">
        {filtered.map((game) => {
          const isSelected = boardGame && gameKey(boardGame) === gameKey(game);

          return (
            <button
              key={gameKey(game)}
              type="button"
              aria-pressed={Boolean(isSelected)}
              className={cn("leaderboards__game", {
                "leaderboards__game--selected": isSelected,
              })}
              onClick={() => setSelectedKey(gameKey(game))}
            >
              <span
                className="leaderboards__game-cover"
                style={backgroundStyle(game.coverImageUrl, "--cover")}
              />
              <span className="leaderboards__game-body">
                <span className="leaderboards__game-title">{game.title}</span>
                <span className="leaderboards__game-rank">
                  <span className="leaderboards__game-position">
                    {t("ordinal", { rank: game.rank })}
                  </span>
                  {game.total !== null && (
                    <span className="leaderboards__game-total">
                      {t("of_total", {
                        total: formatBoardTotal(
                          game.total,
                          numberFormatter.format
                        ),
                      })}
                    </span>
                  )}
                  {isWeek && (
                    <RankDelta
                      delta={getRankDelta(game.rank, game.previousRank)}
                    />
                  )}
                </span>
                {game.leader && (
                  <span className="leaderboards__game-leader">
                    <Avatar
                      size={16}
                      src={game.leader.profileImageUrl}
                      alt={game.leader.displayName}
                    />
                    {t("leader_name", { name: game.leader.displayName })}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    );
  };

  const renderBoard = () => {
    if (hasNoGameMetrics) {
      return (
        <BlockMessage
          icon={<TrophyIcon size={24} />}
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
          icon={<TrophyIcon size={24} />}
          title={t(isWeek ? "empty_week_title" : "empty_all_title")}
          description={t(
            isWeek ? "empty_week_description" : "empty_all_description"
          )}
        />
      );
    }

    if (boardState === "empty_friends") {
      return (
        <BlockMessage
          icon={<PeopleIcon size={24} />}
          title={t("empty_friends_game_title")}
          description={t("empty_friends_description")}
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
      <section className="leaderboards__my-games">
        <div className="leaderboards__section-header">
          <h2 className="leaderboards__heading-2">{t("my_games_title")}</h2>
          <label className="leaderboards__search">
            <SearchIcon size={14} />
            <span className="leaderboards__sr-only">{t("search_game")}</span>
            <input
              type="text"
              value={search}
              placeholder={t("search_game_placeholder")}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setSearch("");
              }}
            />
            {search && (
              <button
                type="button"
                className="leaderboards__search-clear"
                onClick={() => setSearch("")}
                aria-label={t("clear_search")}
                title={t("clear_search")}
              >
                <XIcon size={14} />
              </button>
            )}
          </label>
        </div>
        {renderGames()}
      </section>

      {boardGame && (
        <section
          className="leaderboards__board leaderboards__board--game"
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
              onClick={() =>
                navigate(
                  buildGameDetailsPath({
                    shop: boardGame.shop as GameShop,
                    objectId: boardGame.objectId,
                    title: selected?.title ?? "",
                  })
                )
              }
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
