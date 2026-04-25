import { HomePageHero } from "./hero";
import { useFeaturedGame } from "./hero/use-featured-game";
import {
  getAchievementsGameFocusId,
  getPopularGameFocusId,
  getWeeklyGameFocusId,
  HOME_ACHIEVEMENTS_GAMES_ROW_REGION_ID,
  HOME_HERO_OPEN_GAME_PAGE_ID,
  HOME_POPULAR_GAMES_ROW_REGION_ID,
  HOME_WEEKLY_GAMES_ROW_REGION_ID,
} from "./navigation";
import { PopularGames } from "./popular-games";
import { usePopularGames } from "./use-popular-games";

import "./page.scss";

export default function Home() {
  const { featuredGame, isLoading: isFeaturedLoading } = useFeaturedGame();
  const { popularGames, gamesOfTheWeek, gamesToBeat } = usePopularGames();
  const getPopularGameIdByIndex = (gameIndex: number) => {
    const game = popularGames[Math.min(gameIndex, popularGames.length - 1)];

    return game ? getPopularGameFocusId(game) : null;
  };
  const getWeeklyGameIdByIndex = (gameIndex: number) => {
    const game = gamesOfTheWeek[Math.min(gameIndex, gamesOfTheWeek.length - 1)];

    return game ? getWeeklyGameFocusId(game) : null;
  };
  const getAchievementsGameIdByIndex = (gameIndex: number) => {
    const game = gamesToBeat[Math.min(gameIndex, gamesToBeat.length - 1)];

    return game ? getAchievementsGameFocusId(game) : null;
  };

  return (
    <section className="home-page">
      <HomePageHero featuredGame={featuredGame} />
      {!isFeaturedLoading && (
        <>
          <PopularGames
            title="Popular Games"
            games={popularGames}
            rowId={HOME_POPULAR_GAMES_ROW_REGION_ID}
            getFocusId={getPopularGameFocusId}
            getDownFocusId={getWeeklyGameIdByIndex}
            firstRowUpTarget={
              featuredGame
                ? { type: "item", itemId: HOME_HERO_OPEN_GAME_PAGE_ID }
                : { type: "block" }
            }
          />
          <PopularGames
            title="Games of the Week"
            games={gamesOfTheWeek}
            rowId={HOME_WEEKLY_GAMES_ROW_REGION_ID}
            getFocusId={getWeeklyGameFocusId}
            getUpFocusId={getPopularGameIdByIndex}
            getDownFocusId={getAchievementsGameIdByIndex}
          />
          <PopularGames
            title="Games to Beat"
            games={gamesToBeat}
            rowId={HOME_ACHIEVEMENTS_GAMES_ROW_REGION_ID}
            getFocusId={getAchievementsGameFocusId}
            getUpFocusId={getWeeklyGameIdByIndex}
          />
        </>
      )}
    </section>
  );
}
