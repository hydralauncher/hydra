import { HomePageHero } from "./hero";
import { useFeaturedGame } from "./hero/use-featured-game";
import type { ShopAssets } from "@types";
import { useMemo } from "react";
import {
  getAchievementsGameFocusId,
  getPopularGameFocusId,
  getWeeklyGameFocusId,
  HOME_ACHIEVEMENTS_GAMES_ROW_REGION_ID,
  HOME_PAGE_REGION_ID,
  HOME_POPULAR_GAMES_ROW_REGION_ID,
  HOME_WEEKLY_GAMES_ROW_REGION_ID,
} from "./navigation";
import { PopularGames } from "./popular-games";
import { usePopularGames } from "./use-popular-games";
import { VerticalFocusGroup } from "../../components";
import type { FocusOverrideTarget } from "../../services";

import "./page.scss";

interface HomeGamesRow {
  key: "popular" | "weekly" | "achievements";
  title: string;
  games: ShopAssets[];
  rowId: string;
  getFocusId: (game: Pick<ShopAssets, "shop" | "objectId">) => string;
}

export default function Home() {
  const { featuredGame, isLoading: isFeaturedLoading } = useFeaturedGame();
  const { popularGames, gamesOfTheWeek, gamesToBeat } = usePopularGames();
  const visibleRows = useMemo<HomeGamesRow[]>(() => {
    const rows: HomeGamesRow[] = [
      {
        key: "popular",
        title: "Popular Games",
        games: popularGames,
        rowId: HOME_POPULAR_GAMES_ROW_REGION_ID,
        getFocusId: getPopularGameFocusId,
      },
      {
        key: "weekly",
        title: "Games of the Week",
        games: gamesOfTheWeek,
        rowId: HOME_WEEKLY_GAMES_ROW_REGION_ID,
        getFocusId: getWeeklyGameFocusId,
      },
      {
        key: "achievements",
        title: "Games to Beat",
        games: gamesToBeat,
        rowId: HOME_ACHIEVEMENTS_GAMES_ROW_REGION_ID,
        getFocusId: getAchievementsGameFocusId,
      },
    ];

    return rows.filter((row) => row.games.length > 0);
  }, [gamesOfTheWeek, gamesToBeat, popularGames]);

  const getVisibleRowGameIdByIndex = (
    row: HomeGamesRow | undefined,
    gameIndex: number
  ) => {
    if (!row) return null;

    const game = row.games[Math.min(gameIndex, row.games.length - 1)];

    return game ? row.getFocusId(game) : null;
  };

  const heroDownNavigationTarget: FocusOverrideTarget | undefined =
    visibleRows[0]
      ? {
          type: "region",
          regionId: visibleRows[0].rowId,
          entryDirection: "right",
        }
      : undefined;

  return (
    <VerticalFocusGroup regionId={HOME_PAGE_REGION_ID} asChild>
      <section className="home-page">
        <HomePageHero
          featuredGame={featuredGame}
          downNavigationTarget={heroDownNavigationTarget}
        />
        {!isFeaturedLoading && (
          <>
            {visibleRows.map((row, rowIndex) => {
              const previousRow = visibleRows[rowIndex - 1];
              const nextRow = visibleRows[rowIndex + 1];

              return (
                <PopularGames
                  key={row.key}
                  title={row.title}
                  games={row.games}
                  rowId={row.rowId}
                  getFocusId={row.getFocusId}
                  getUpFocusId={
                    previousRow
                      ? (gameIndex) =>
                          getVisibleRowGameIdByIndex(previousRow, gameIndex)
                      : undefined
                  }
                  getDownFocusId={
                    nextRow
                      ? (gameIndex) =>
                          getVisibleRowGameIdByIndex(nextRow, gameIndex)
                      : undefined
                  }
                  canNavigateUpToHero={rowIndex === 0 && Boolean(featuredGame)}
                />
              );
            })}
          </>
        )}
      </section>
    </VerticalFocusGroup>
  );
}
