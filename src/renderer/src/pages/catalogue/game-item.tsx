import { Badge } from "@renderer/components";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useAppSelector, useRepacks } from "@renderer/hooks";
import { steamUrlBuilder } from "@shared";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

import "./game-item.scss";
import { useTranslation } from "react-i18next";

export interface GameItemProps {
  game: any;
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

  return (
    <button
      type="button"
      className="game-item"
      onClick={() => navigate(buildGameDetailsPath(game))}
    >
      <img
        className="game-item__cover"
        src={steamUrlBuilder.library(game.objectId)}
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
