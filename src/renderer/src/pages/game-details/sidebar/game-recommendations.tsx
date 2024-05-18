import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { CatalogueEntry } from "@types";

import * as styles from "./game-recommendations.css";
import { GameCard } from "@renderer/components";
import { useNavigate } from "react-router-dom";
import { buildGameDetailsPath } from "@renderer/helpers";

export default function SteamGameRecommendations({
  gameID: objectID,
}: Readonly<{
  gameID: string;
}>) {
  const { t } = useTranslation("game_details");
  const [gameRecommendedList, setGameRecommendedList] = useState<
    CatalogueEntry[]
  >([]);
  const quantityRecommendedGames = 5;
  const navigate = useNavigate();

  useEffect(() => {
    window.electron
      .getSteamRecommendationsByGenre(objectID)
      .then((recommendationsID) => {
        window.electron
          .searchGamesByID(recommendationsID.map((n) => String(n.id)))
          .then((gameList) => {
            setGameRecommendedList(gameList);
          });
      });
  }, [objectID]);

  return (
    <>
      <div className={styles.contentSidebarTitle}>
        <h3>{t("recommended_games")}</h3>
      </div>

      <section className={styles.cards}>
        {gameRecommendedList
          .filter((game) => game.objectID !== objectID)
          .filter((game) => game.repacks.length > 0)
          .filter((_, index) => index < quantityRecommendedGames)
          .map((game) => (
            <GameCard
              key={game.objectID}
              game={game}
              onClick={() => navigate(buildGameDetailsPath(game))}
            />
          ))}
      </section>
    </>
  );
}
