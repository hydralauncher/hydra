import { QuestionIcon, PlusIcon, CheckIcon } from "@primer/octicons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";

import { Badge } from "@renderer/components/badge/badge";
import { Link } from "@renderer/components/link/link";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useAppSelector, useLibrary } from "@renderer/hooks";

import type { CatalogueSearchResult } from "@types";

import "./game-item-classics.scss";

const BADGE_GAP = 8;
const OVERFLOW_BADGE_RESERVE = 44;

function SourceBadges({ sources }: Readonly<{ sources: string[] }>) {
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(sources.length);

  useEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure) return;

    const compute = () => {
      const available = row.clientWidth;
      if (available === 0) return;

      const widths = Array.from(measure.children).map(
        (child) => (child as HTMLElement).offsetWidth
      );

      const fit = (reserveOverflow: boolean) => {
        let total = reserveOverflow ? OVERFLOW_BADGE_RESERVE + BADGE_GAP : 0;
        let count = 0;
        for (let i = 0; i < widths.length; i++) {
          total += widths[i] + (i > 0 ? BADGE_GAP : 0);
          if (total > available) break;
          count++;
        }
        return count;
      };

      const all = fit(false);
      setVisibleCount(
        all >= sources.length ? sources.length : Math.max(1, fit(true))
      );
    };

    const observer = new ResizeObserver(compute);
    observer.observe(row);
    compute();
    return () => observer.disconnect();
  }, [sources]);

  if (sources.length === 0) return null;

  const visible = sources.slice(0, visibleCount);
  const hidden = sources.length - visible.length;

  return (
    <>
      <div
        ref={measureRef}
        className="game-item-classics__repackers-measure"
        aria-hidden="true"
      >
        {sources.map((sourceName) => (
          <Badge key={sourceName}>{sourceName}</Badge>
        ))}
      </div>
      <div ref={rowRef} className="game-item-classics__repackers">
        {visible.map((sourceName) => (
          <Badge key={sourceName}>{sourceName}</Badge>
        ))}
        {hidden > 0 && <Badge>+{hidden}</Badge>}
      </div>
    </>
  );
}

export interface GameItemClassicsProps {
  game: CatalogueSearchResult;
}

export function GameItemClassics({ game }: GameItemClassicsProps) {
  const { i18n, t } = useTranslation("game_details");
  const language = i18n.language.split("-")[0];

  const { steamGenres } = useAppSelector((state) => state.catalogueSearch);

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

  const addGameToLibrary = async () => {
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

          <SourceBadges sources={game.downloadSources} />
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
        {added ? <CheckIcon size={16} /> : <PlusIcon size={16} />}
      </button>
    </article>
  );
}
