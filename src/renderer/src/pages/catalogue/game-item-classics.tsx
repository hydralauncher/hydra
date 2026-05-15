import { QuestionIcon } from "@primer/octicons-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Link } from "@renderer/components/link/link";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useAppSelector } from "@renderer/hooks";

import type { CatalogueSearchResult } from "@types";

import "./game-item-classics.scss";

export interface GameItemClassicsProps {
  game: CatalogueSearchResult;
}

export function GameItemClassics({ game }: GameItemClassicsProps) {
  const { i18n, t } = useTranslation("game_details");
  const language = i18n.language.split("-")[0];

  const { steamGenres } = useAppSelector((state) => state.catalogueSearch);

  const genres = useMemo(() => {
    return game.genres?.map((genre) => {
      const index = steamGenres["en"]?.findIndex(
        (steamGenre) => steamGenre === genre
      );

      if (
        index !== undefined &&
        steamGenres[language] &&
        steamGenres[language][index]
      ) {
        return steamGenres[language][index];
      }

      return genre;
    });
  }, [game.genres, language, steamGenres]);

  return (
    <article className="game-item-classics">
      <Link
        to={buildGameDetailsPath(game)}
        className="game-item-classics__link"
      >
        <div className="game-item-classics__cover">
          {game.libraryImageUrl ? (
            <>
              <img
                className="game-item-classics__cover-backdrop"
                src={game.libraryImageUrl}
                alt=""
                aria-hidden="true"
                loading="lazy"
              />
              <img
                className="game-item-classics__cover-image"
                src={game.libraryImageUrl}
                alt={game.title}
                loading="lazy"
              />
            </>
          ) : (
            <div className="game-item-classics__cover-placeholder">
              <QuestionIcon size={32} />
            </div>
          )}

          {game.platform && (
            <span className="game-item-classics__platform-chip">
              {game.platform}
            </span>
          )}
        </div>

        <div className="game-item-classics__details">
          <span className="game-item-classics__title" title={game.title}>
            {game.title}
          </span>
          {genres && genres.length > 0 ? (
            <span className="game-item-classics__genres">
              {genres.join(", ")}
            </span>
          ) : (
            <span className="game-item-classics__genres game-item-classics__genres--empty">
              {t("no_genres", { ns: "catalogue" })}
            </span>
          )}
        </div>
      </Link>
    </article>
  );
}
