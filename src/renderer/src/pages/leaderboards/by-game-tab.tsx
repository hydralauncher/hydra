import { useEffect, useMemo, useState } from "react";
import cn from "classnames";
import {
  LinkExternalIcon,
  PeopleIcon,
  SearchIcon,
  TrophyIcon,
} from "@primer/octicons-react";
import Skeleton from "react-loading-skeleton";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Avatar } from "@renderer/components";
import { useFormat } from "@renderer/hooks";
import type { GameShop } from "@types";
import {
  LEADERBOARD_METRICS,
  type LeaderboardMetric,
  type LeaderboardUser,
} from "../game-details/leaderboard/game-leaderboard";
import { useLeaderboardValue } from "../game-details/leaderboard/use-leaderboard-value";
import {
  getBoardState,
  getRankDelta,
  getViewerRanking,
  GLOBAL_LEADERBOARD_TAKE,
  normalizeGlobalLeaderboardResponse,
  normalizeMyGames,
  type GlobalLeaderboardPeriod,
  type GlobalLeaderboardScope,
  type MyGameRanking,
} from "./global-leaderboard";
import { useApiResource } from "./leaderboards-api";
import { BoardView } from "./board-view";
import {
  BlockError,
  BlockMessage,
  BoardSkeleton,
  RankDelta,
} from "./leaderboard-bits";

export interface LinkedGame {
  shop: string;
  objectId: string;
}

export interface ByGameTabProps {
  period: GlobalLeaderboardPeriod;
  scope: GlobalLeaderboardScope;
  viewerUser: LeaderboardUser | null;
  initialGame?: LinkedGame | null;
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

  return assets && assets.shop === shop && assets.objectId === objectId
    ? assets
    : null;
}

export function ByGameTab({
  period,
  scope,
  viewerUser,
  initialGame = null,
}: ByGameTabProps) {
  const { t } = useTranslation("leaderboards");
  const { t: tLeaderboard } = useTranslation("leaderboard");
  const navigate = useNavigate();
  const formatGameValue = useLeaderboardValue();
  const { numberFormatter } = useFormat();
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(
    initialGame ? gameKey(initialGame) : null
  );
  const [metric, setMetric] = useState<LeaderboardMetric>("playtime");

  const games = useApiResource(
    "/leaderboards/me/games",
    { params: { window: period, scope }, needsAuth: true },
    normalizeMyGames
  );

  const allGames = useMemo(() => games.data ?? [], [games.data]);
  const listed = allGames.find((game) => gameKey(game) === selectedKey);
  const linkedGame =
    initialGame && selectedKey === gameKey(initialGame) && games.data && !listed
      ? initialGame
      : null;
  const linkedAssets = useLinkedGameAssets(linkedGame);
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
    selected
      ? `/games/${selected.shop}/${encodeURIComponent(selected.objectId)}/leaderboards/${metric}`
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
    isLoading: board.isLoading,
    hasError: board.hasError,
    leaderboard: board.data,
    scope,
    viewerId,
  });

  const formatValue = (value: number) => formatGameValue(metric, value);

  const viewerRanking = getViewerRanking(board.data, viewerId);
  const heroRank = selected?.rank ?? viewerRanking?.rank ?? null;
  const heroTotal = selected?.total ?? board.data?.total ?? null;
  let heroSubtitle = "";
  if (heroRank !== null && heroTotal !== null) {
    heroSubtitle = t("game_ranking_subtitle", {
      total: numberFormatter.format(heroTotal),
      rank: heroRank,
    });
  } else if (heroTotal !== null) {
    heroSubtitle = t("players_count", { count: heroTotal });
  }

  const metricChips = (
    <div
      className="leaderboards__chips"
      role="group"
      aria-label={t("metric_label")}
    >
      {LEADERBOARD_METRICS.map((id) => (
        <button
          key={id}
          type="button"
          aria-pressed={id === metric}
          className={cn("leaderboards__chip", {
            "leaderboards__chip--selected": id === metric,
          })}
          onClick={() => setMetric(id)}
        >
          {tLeaderboard(`metric_${id}`)}
        </button>
      ))}
    </div>
  );

  const renderGames = () => {
    if (games.isLoading && !games.data) {
      return (
        <div className="leaderboards__games">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="leaderboards__game-skeleton" />
          ))}
        </div>
      );
    }

    if (games.hasError) return <BlockError onRetry={games.retry} />;

    if (allGames.length === 0 && !linkedGame) {
      return (
        <BlockMessage
          icon={<TrophyIcon size={24} />}
          title={t("games_empty_title")}
          description={t("games_empty_description")}
        />
      );
    }

    if (filtered.length === 0) {
      return <BlockMessage title={t("games_search_empty")} />;
    }

    return (
      <div className="leaderboards__games">
        {filtered.map((game) => {
          const isSelected = selected && gameKey(selected) === gameKey(game);

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
                  <span className="leaderboards__game-total">
                    {t("of_total", {
                      total: numberFormatter.format(game.total),
                    })}
                  </span>
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
    if (boardState === "loading") return <BoardSkeleton />;
    if (boardState === "error") return <BlockError onRetry={board.retry} />;

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

    if (!board.data || !selected) return null;

    return (
      <BoardView
        leaderboard={board.data}
        viewerUser={viewerUser}
        formatValue={formatValue}
        leaderLabel={t(isWeek ? "leader_of_week" : "record_holder")}
        showDelta={isWeek}
        isLoading={board.isLoading}
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
              type="search"
              value={search}
              placeholder={t("search_game_placeholder")}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>
        {renderGames()}
      </section>

      {selected && (
        <section
          className="leaderboards__board leaderboards__board--game"
          aria-labelledby="game-board-title"
        >
          <div
            className={cn("leaderboards__hero", {
              "leaderboards__hero--image": selected.heroImageUrl,
            })}
            style={backgroundStyle(selected.heroImageUrl, "--hero")}
          >
            <span
              className="leaderboards__hero-cover"
              style={backgroundStyle(selected.coverImageUrl, "--cover")}
            />
            <div className="leaderboards__hero-text">
              <h2 id="game-board-title" className="leaderboards__hero-title">
                {t("game_ranking_title", { game: selected.title })}
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
                  `/game/${selected.shop}/${encodeURIComponent(selected.objectId)}`
                )
              }
            >
              {t("open_game_page")}
              <LinkExternalIcon size={14} />
            </button>
          </div>

          {metricChips}
          {renderBoard()}
        </section>
      )}
    </>
  );
}
