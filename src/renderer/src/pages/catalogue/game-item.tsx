import { Badge } from "@renderer/components";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useAppSelector, useRepacks } from "@renderer/hooks";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

import "./game-item.scss";
import { useTranslation } from "react-i18next";
import { CatalogueSearchResult } from "@types";

export interface GameItemProps {
  game: CatalogueSearchResult;
}

export function GameItem({ game }: GameItemProps) {
  const navigate = useNavigate();

  const { i18n } = useTranslation();

  const { steamGenres } = useAppSelector((state) => state.catalogueSearch);

  const { getRepacksForObjectId } = useRepacks();

  const repacks = getRepacksForObjectId(game.objectId);

  const language = i18n.language.split("-")[0];

  const uniqueRepackers = useMemo(() => {
    return Array.from(new Set(repacks.map((repack) => repack.repacker)));
  }, [repacks]);

  const genres = useMemo(() => {
    return game.genres?.map((genre) => {
      const index = steamGenres["en"]?.findIndex(
        (steamGenre) => steamGenre === genre
      );

      if (index && steamGenres[language] && steamGenres[language][index]) {
        return steamGenres[language][index];
      }

      return genre;
    });
  }, [game.genres, language, steamGenres]);

  const handleNavigateToGameDetails = async () => {
    await window.electron.saveGameShopAssets(game.objectId, game.shop, {
      ...game,
    });

    navigate(buildGameDetailsPath(game));
  };

  return (
    <button
      type="button"
      className="game-item"
      onClick={handleNavigateToGameDetails}
    >
      <img
        className="game-item__cover"
        src={game.libraryImageUrl}
        alt={game.title}
        loading="lazy"
      />

      <div className="game-item__details">
        <span>{game.title}</span>
        <span className="game-item__genres">{genres.join(", ")}</span>

        <div className="game-item__repackers">
          {uniqueRepackers.map((repacker) => (
            <Badge key={repacker}>{repacker}</Badge>
          ))}
        </div>
      </div>
    </button>
  );
}
