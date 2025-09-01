import { Badge } from "@renderer/components";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useAppSelector, useRepacks, useLibrary } from "@renderer/hooks";
import { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

import "./game-item.scss";
import { useTranslation } from "react-i18next";
import { CatalogueSearchResult } from "@types";
import { QuestionIcon, PlusIcon, CheckIcon } from "@primer/octicons-react";
import cn from "classnames";

export interface GameItemProps {
  game: CatalogueSearchResult;
}

export function GameItem({ game }: GameItemProps) {
  const navigate = useNavigate();

  const { i18n, t } = useTranslation("game_details");

  const language = i18n.language.split("-")[0];

  const { steamGenres } = useAppSelector((state) => state.catalogueSearch);

  const { getRepacksForObjectId } = useRepacks();

  const repacks = getRepacksForObjectId(game.objectId);

  const [isAddingToLibrary, setIsAddingToLibrary] = useState(false);

  const [added, setAdded] = useState(false);

  const { library, updateLibrary } = useLibrary();

  useEffect(() => {
    const exists = library.some(
      (libItem) =>
        libItem.shop === game.shop && libItem.objectId === game.objectId
    );
    setAdded(exists);
  }, [library, game.shop, game.objectId]);

  const addGameToLibrary = async (event: React.MouseEvent | React.KeyboardEvent) => {
    event.stopPropagation();
    if (added || isAddingToLibrary) return;

    setIsAddingToLibrary(true);

    try {
      await window.electron.addGameToLibrary(
        game.shop,
        game.objectId,
        game.title
      );
      updateLibrary();
    } catch (error) {
      console.error(error);
    } finally {
      setIsAddingToLibrary(false);
    }
  };

  const uniqueRepackers = useMemo(() => {
    return Array.from(new Set(repacks.map((repack) => repack.repacker)));
  }, [repacks]);

  const genres = useMemo(() => {
    return game.genres?.map((genre) => {
      const index = steamGenres["en"]?.findIndex(
        (steamGenre) => steamGenre === genre
      );

      if (index !== undefined && steamGenres[language] && steamGenres[language][index]) {
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

  const libraryImage = useMemo(() => {
    if (game.libraryImageUrl) {
      return (
        <img
          className="game-item__cover"
          src={game.libraryImageUrl}
          alt={game.title}
          loading="lazy"
        />
      );
    }

    return (
      <div className="game-item__cover-placeholder">
        <QuestionIcon size={28} />
      </div>
    );
  }, [game.libraryImageUrl, game.title]);

  return (
    <button
      type="button"
      className="game-item"
      onClick={() => navigate(buildGameDetailsPath(game))}
    >
      {libraryImage}

      <div className="game-item__details">
        <span>{game.title}</span>
        <span className="game-item__genres">{genres.join(", ")}</span>

        <div className="game-item__repackers">
          {uniqueRepackers.map((repacker) => (
            <Badge key={repacker}>{repacker}</Badge>
          ))}
        </div>
      </div>
      <div
        className={cn("game-item__plus-wrapper", {
          "game-item__plus-wrapper--added": added,
        })}
        role="button"
        tabIndex={0}
        onClick={addGameToLibrary}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            addGameToLibrary(e);
          }
        }}
        title={added ? t("already_in_library") : t("add_to_library")}
      >
        {added ? <CheckIcon size={16} /> : <PlusIcon size={16} />}
      </div>
    </button>
  );
}
