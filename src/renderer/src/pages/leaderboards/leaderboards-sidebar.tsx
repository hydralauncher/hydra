import { useEffect, useState } from "react";
import cn from "classnames";
import { GraphIcon } from "@primer/octicons-react";
import Skeleton from "react-loading-skeleton";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Avatar, TextField } from "@renderer/components";
import {
  LEADERBOARD_ROW_BANNER_IMAGE_SIZE,
  LEADERBOARD_SIDEBAR_COVER_IMAGE_SIZE,
} from "@renderer/constants";
import { useFormat, useProcessedImage } from "@renderer/hooks";
import type { LeaderboardUser } from "../game-details/leaderboard/game-leaderboard";
import { gameKey } from "./by-game-tab";
import { HeaderSelector } from "./header-selector";
import type { MetricDefinition, MyGameRanking } from "./global-leaderboard";
import { MetricIcon } from "./metric-icon";
import {
  EMPTY_BOARD_RESULT,
  type GlobalBoardResults,
} from "./use-global-leaderboards";
import { useMetricText } from "./use-global-leaderboard-value";

const GAME_SKELETON_COUNT = 4;
const GAME_SKELETON_KEYS = Array.from(
  { length: GAME_SKELETON_COUNT },
  (_, index) => `sidebar-game-skeleton-${index}`
);

type SidebarList = "categories" | "games";

export interface LeaderboardsSidebarProps {
  results: GlobalBoardResults;
  metrics: MetricDefinition[];
  isMetricsLoading: boolean;
  games: MyGameRanking[];
  isGamesLoading: boolean;
  hasGamesError: boolean;
  isLoggedIn: boolean;
  isStatsSelected: boolean;
  isGameBoardSelected: boolean;
  selectedMetricId: string | null;
  selectedGameKey: string | null;
  onSelectStats: () => void;
  onSelectMetric: (metric: string) => void;
  onSelectGame: (key: string) => void;
  onRetryGames: () => void;
}

function SidebarItem({
  isSelected,
  bannerUrl = null,
  onClick,
  children,
}: Readonly<{
  isSelected: boolean;
  bannerUrl?: string | null;
  onClick: () => void;
  children: React.ReactNode;
}>) {
  const banner = useProcessedImage(
    bannerUrl,
    LEADERBOARD_ROW_BANNER_IMAGE_SIZE
  );

  return (
    <button
      type="button"
      className={cn("leaderboards__side-item", {
        "leaderboards__side-item--selected": isSelected,
        "leaderboards__side-item--banner": banner,
      })}
      aria-current={isSelected ? "true" : undefined}
      onClick={onClick}
    >
      {banner && (
        <span
          className="leaderboards__side-banner"
          style={{ backgroundImage: `url(${JSON.stringify(banner)})` }}
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  );
}

// A small resized copy, so a long list does not decode full size covers.
function SidebarCover({ url }: Readonly<{ url: string | null }>) {
  const cover = useProcessedImage(url, LEADERBOARD_SIDEBAR_COVER_IMAGE_SIZE);

  return cover ? (
    <img
      className="leaderboards__side-cover"
      src={cover}
      alt=""
      loading="lazy"
      decoding="async"
    />
  ) : (
    <span className="leaderboards__side-cover" />
  );
}

function SidebarLeader({ user }: Readonly<{ user: LeaderboardUser }>) {
  return (
    <span className="leaderboards__side-leader">
      <Avatar size={20} src={user.profileImageUrl} alt={user.displayName} />
      <span className="leaderboards__side-leader-name">{user.displayName}</span>
    </span>
  );
}

export function LeaderboardsSidebar({
  results,
  metrics,
  isMetricsLoading,
  games,
  isGamesLoading,
  hasGamesError,
  isLoggedIn,
  isStatsSelected,
  isGameBoardSelected,
  selectedMetricId,
  selectedGameKey,
  onSelectStats,
  onSelectMetric,
  onSelectGame,
  onRetryGames,
}: Readonly<LeaderboardsSidebarProps>) {
  const { t } = useTranslation("leaderboards");
  const navigate = useNavigate();
  const { numberFormatter } = useFormat();
  const metricText = useMetricText();
  const [search, setSearch] = useState("");
  // Shows the list of what is on screen. Changing it does not change the board.
  const [requestedList, setList] = useState<SidebarList>(
    isGameBoardSelected ? "games" : "categories"
  );
  const list = isLoggedIn ? requestedList : "categories";

  useEffect(() => {
    if (isGameBoardSelected) setList("games");
  }, [isGameBoardSelected]);

  const renderMetric = (definition: MetricDefinition) => {
    const result = results[definition.id] ?? EMPTY_BOARD_RESULT;
    const leader = result.leaderboard?.entries[0] ?? null;

    let leaderLine: React.ReactNode = (
      <span className="leaderboards__side-note">{t("no_leader")}</span>
    );
    if (result.hasError) {
      leaderLine = (
        <span className="leaderboards__side-note">{t("leader_error")}</span>
      );
    } else if (result.isLoading && !result.leaderboard) {
      leaderLine = <Skeleton width={120} />;
    } else if (leader) {
      leaderLine = <SidebarLeader user={leader.user} />;
    }

    return (
      <SidebarItem
        key={definition.id}
        isSelected={definition.id === selectedMetricId}
        bannerUrl={leader?.user.backgroundImageUrl}
        onClick={() => onSelectMetric(definition.id)}
      >
        <span className="leaderboards__side-icon">
          <MetricIcon metric={definition.id} size={20} />
        </span>
        <span className="leaderboards__side-text">
          <span className="leaderboards__side-top">
            <span className="leaderboards__side-title">
              {metricText.label(definition)}
            </span>
            {leader && (
              <span className="leaderboards__side-rank">
                {metricText.format(definition, leader.value)}
              </span>
            )}
          </span>
          {leaderLine}
        </span>
      </SidebarItem>
    );
  };

  const renderGame = (game: MyGameRanking) => {
    const key = gameKey(game);

    return (
      <SidebarItem
        key={key}
        isSelected={key === selectedGameKey}
        bannerUrl={game.leader?.backgroundImageUrl}
        onClick={() => onSelectGame(key)}
      >
        <SidebarCover url={game.coverImageUrl} />
        <span className="leaderboards__side-text">
          <span className="leaderboards__side-top">
            <span className="leaderboards__side-title">{game.title}</span>
            <span className="leaderboards__side-rank">
              {t("ordinal", { rank: numberFormatter.format(game.rank) })}
            </span>
          </span>
          {game.leader && <SidebarLeader user={game.leader} />}
        </span>
      </SidebarItem>
    );
  };

  const renderGames = () => {
    if (isGamesLoading && games.length === 0) {
      return GAME_SKELETON_KEYS.map((key) => (
        <Skeleton key={key} className="leaderboards__side-skeleton" />
      ));
    }

    if (hasGamesError) {
      return (
        <button
          type="button"
          className="leaderboards__side-more"
          onClick={onRetryGames}
        >
          {t("retry")}
        </button>
      );
    }

    if (games.length === 0) {
      return (
        <>
          <p className="leaderboards__side-empty">
            {t("games_empty_description")}
          </p>
          <button
            type="button"
            className="leaderboards__side-more"
            onClick={() => navigate("/library")}
          >
            {t("go_to_library")}
          </button>
        </>
      );
    }

    const term = search.trim().toLocaleLowerCase();
    const filtered = term
      ? games.filter((game) => game.title.toLocaleLowerCase().includes(term))
      : games;
    return (
      <>
        <TextField
          theme="dark"
          aria-label={t("search_game")}
          value={search}
          placeholder={t("search_game_placeholder")}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setSearch("");
          }}
        />

        {filtered.length === 0 ? (
          <p className="leaderboards__side-empty">{t("games_search_empty")}</p>
        ) : (
          filtered.map(renderGame)
        )}
      </>
    );
  };

  return (
    <nav className="leaderboards__sidebar" aria-label={t("sidebar_label")}>
      {isLoggedIn && (
        <div className="leaderboards__side-group leaderboards__side-group--stats">
          <SidebarItem isSelected={isStatsSelected} onClick={onSelectStats}>
            <span className="leaderboards__side-icon">
              <GraphIcon size={16} />
            </span>
            <span className="leaderboards__side-title">{t("tab_stats")}</span>
          </SidebarItem>
        </div>
      )}

      {isLoggedIn && (
        <HeaderSelector
          label={t("sidebar_label")}
          showLabel={false}
          value={list}
          onChange={setList}
          options={[
            { id: "categories", label: t("sidebar_categories") },
            { id: "games", label: t("tab_games") },
          ]}
        />
      )}

      <div className="leaderboards__side-group">
        {list === "games" && renderGames()}
        {list === "categories" &&
          (isMetricsLoading && metrics.length === 0
            ? GAME_SKELETON_KEYS.map((key) => (
                <Skeleton key={key} className="leaderboards__side-skeleton" />
              ))
            : metrics.map(renderMetric))}
      </div>
    </nav>
  );
}
