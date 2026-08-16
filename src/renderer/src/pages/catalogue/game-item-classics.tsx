import { QuestionIcon, PlusIcon, CheckIcon } from "@primer/octicons-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";

import { Link } from "@renderer/components/link/link";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useLibrary } from "@renderer/hooks";

import type { CatalogueSearchResult } from "@types";

import "./game-item-classics.scss";

export interface GameItemClassicsProps {
  game: CatalogueSearchResult;
}

export function GameItemClassics({ game }: Readonly<GameItemClassicsProps>) {
  const { t } = useTranslation("game_details");
  const { library, updateLibrary } = useLibrary();
  const [isAddingToLibrary, setIsAddingToLibrary] = useState(false);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    const exists = library.some(
      (libItem) =>
        libItem.shop === game.shop && libItem.objectId === game.objectId
    );
    setAdded(exists);
  }, [library, game.shop, game.objectId]);

  const addGameToLibrary = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (added || isAddingToLibrary) return;

    setIsAddingToLibrary(true);

    try {
      await window.electron.addGameToLibrary(
        game.shop,
        game.objectId,
        game.title,
        game.platform ?? null
      );
      updateLibrary();
    } catch (error) {
      console.error(error);
    } finally {
      setIsAddingToLibrary(false);
    }
  };

  const tooltipText = game.platform
    ? `${game.title} • ${game.platform}`
    : game.title;

  return (
    <article
      className="game-item-classics"
      data-tooltip-id="classics-tooltip"
      data-tooltip-content={tooltipText}
      data-tooltip-place="top"
    >
      <Link
        to={buildGameDetailsPath(game)}
        className="game-item-classics__link"
        aria-label={game.title}
      >
        <div className="game-item-classics__cover">
          {game.libraryImageUrl ? (
            <img
              className="game-item-classics__cover-image"
              src={game.libraryImageUrl}
              alt={game.title}
              loading="lazy"
            />
          ) : (
            <div className="game-item-classics__cover-placeholder">
              <QuestionIcon size={28} />
            </div>
          )}
        </div>
      </Link>

      <button
        type="button"
        className={cn("game-item-classics__plus-wrapper", {
          "game-item-classics__plus-wrapper--added": added,
        })}
        onClick={addGameToLibrary}
        title={added ? t("already_in_library") : t("add_to_library")}
        aria-label={added ? t("already_in_library") : t("add_to_library")}
        disabled={added || isAddingToLibrary}
      >
        {added ? <CheckIcon size={13} /> : <PlusIcon size={13} />}
      </button>
    </article>
  );
}
