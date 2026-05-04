import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@renderer/hooks";
import { useCatalogue } from "@renderer/hooks/use-catalogue";
import { setFilters, setPage, clearFilters } from "@renderer/features";
import { debounce } from "lodash-es";
import type { CatalogueSearchResult, DownloadSource } from "@types";
import type { CatalogueSearchPayload } from "@types";
import { SearchIcon } from "@primer/octicons-react";
import { useBigPictureContext } from "./big-picture-app";
import { BigPictureCatalogueCard } from "./big-picture-catalogue-card";
import "./big-picture-catalogue.scss";

const PAGE_SIZE = 24;

const POPULAR_GENRES = [
  "Action",
  "Adventure",
  "RPG",
  "Strategy",
  "Simulation",
  "Sports",
  "Racing",
  "Indie",
  "Puzzle",
  "Shooter",
];

export default function BigPictureCatalogue() {
  const { t, i18n } = useTranslation("big_picture");
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const abortControllerRef = useRef<AbortController | null>(null);

  const { downloadSources } = useCatalogue();
  const { registerPageHandler, unregisterPageHandler } = useBigPictureContext();

  const { steamGenres, filters, page } = useAppSelector(
    (state) => state.catalogueSearch
  );

  const [results, setResults] = useState<CatalogueSearchResult[]>([]);
  const [itemsCount, setItemsCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const language = i18n.language.split("-")[0];

  const steamGenresMapping = useMemo<Record<string, string>>(() => {
    if (!steamGenres[language]) return {};
    return steamGenres[language].reduce(
      (prev, genre, index) => {
        prev[genre] = steamGenres["en"][index];
        return prev;
      },
      {} as Record<string, string>
    );
  }, [steamGenres, language]);

  const getGenreLocalizedName = useCallback(
    (englishGenre: string) => {
      const localizedName = Object.keys(steamGenresMapping).find(
        (key) => steamGenresMapping[key] === englishGenre
      );
      return localizedName || englishGenre;
    },
    [steamGenresMapping]
  );

  const totalPages = Math.ceil(itemsCount / PAGE_SIZE);

  const debouncedSearch = useRef(
    debounce(
      async (
        filters: CatalogueSearchPayload,
        downloadSources: DownloadSource[],
        pageSize: number,
        offset: number
      ) => {
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        const requestData = {
          ...filters,
          take: pageSize,
          skip: offset,
          downloadSourceIds: downloadSources.map((s) => s.id),
        };

        const response = await window.electron.hydraApi.post<{
          edges: CatalogueSearchResult[];
          count: number;
        }>("/catalogue/search", {
          data: requestData,
          needsAuth: false,
        });

        if (abortController.signal.aborted) return;

        setResults(response.edges);
        setItemsCount(response.count);
        setIsLoading(false);
      },
      500
    )
  ).current;

  useEffect(() => {
    setResults([]);
    setIsLoading(true);
    abortControllerRef.current?.abort();

    debouncedSearch(
      filters,
      downloadSources,
      PAGE_SIZE,
      (page - 1) * PAGE_SIZE
    );

    return () => {
      debouncedSearch.cancel();
    };
  }, [filters, downloadSources, page, debouncedSearch]);

  // LT/RT for page navigation
  useEffect(() => {
    const handler = (direction: "prev" | "next"): boolean => {
      if (direction === "next" && page < totalPages) {
        dispatch(setPage(page + 1));
        return true;
      }
      if (direction === "prev" && page > 1) {
        dispatch(setPage(page - 1));
        return true;
      }
      return false;
    };

    registerPageHandler(handler);
    return () => unregisterPageHandler();
  }, [page, totalPages, dispatch, registerPageHandler, unregisterPageHandler]);

  const toggleGenre = useCallback(
    (genreEnglish: string) => {
      if (filters.genres.includes(genreEnglish)) {
        dispatch(
          setFilters({
            genres: filters.genres.filter((g) => g !== genreEnglish),
          })
        );
      } else {
        dispatch(
          setFilters({
            genres: [...filters.genres, genreEnglish],
          })
        );
      }
    },
    [filters.genres, dispatch]
  );

  const handleGameClick = useCallback(
    (game: CatalogueSearchResult) => {
      navigate(`/big-picture/game/${game.shop}/${game.objectId}`);
    },
    [navigate]
  );

  const hasActiveFilters = filters.genres.length > 0;

  return (
    <div className="bp-catalogue">
      {/* Genre chips */}
      <div className="bp-catalogue__filters">
        <div className="bp-catalogue__genre-chips">
          {POPULAR_GENRES.map((genre) => (
            <button
              key={genre}
              type="button"
              className={`bp-catalogue__genre-chip ${
                filters.genres.includes(genre)
                  ? "bp-catalogue__genre-chip--active"
                  : ""
              }`}
              data-bp-focusable
              onClick={() => toggleGenre(genre)}
            >
              {getGenreLocalizedName(genre)}
            </button>
          ))}

          {hasActiveFilters && (
            <button
              type="button"
              className="bp-catalogue__clear-btn"
              data-bp-focusable
              onClick={() => dispatch(clearFilters())}
            >
              {t("catalogue_clear_filters")}
            </button>
          )}
        </div>

        {/* Page indicator */}
        {totalPages > 1 && (
          <div className="bp-catalogue__page-info">
            <span className="bp-catalogue__page-badge">
              {t("catalogue_page", { current: page, total: totalPages })}
            </span>
            <span className="bp-catalogue__page-hint">
              LT / RT {t("catalogue_change_page")}
            </span>
          </div>
        )}
      </div>

      {/* Results count */}
      {!isLoading && itemsCount > 0 && (
        <div className="bp-catalogue__result-count">
          {t("catalogue_results", { count: itemsCount })}
        </div>
      )}

      {/* Game grid */}
      {isLoading ? (
        <div className="bp-catalogue__grid">
          {Array.from({ length: PAGE_SIZE }).map((_, i) => (
            <div key={i} className="bp-catalogue__skeleton" />
          ))}
        </div>
      ) : results.length === 0 ? (
        <div className="bp-catalogue__empty">
          <SearchIcon size={48} />
          <h2>{t("catalogue_no_results")}</h2>
          <p>{t("catalogue_no_results_description")}</p>
          {hasActiveFilters && (
            <button
              type="button"
              className="bp-catalogue__clear-btn bp-catalogue__clear-btn--large"
              data-bp-focusable
              onClick={() => dispatch(clearFilters())}
            >
              {t("catalogue_clear_filters")}
            </button>
          )}
        </div>
      ) : (
        <div className="bp-catalogue__grid">
          {results.map((game, index) => (
            <BigPictureCatalogueCard
              key={game.id}
              game={game}
              onClick={() => handleGameClick(game)}
              index={index}
            />
          ))}
        </div>
      )}

      {/* Pagination buttons */}
      {!isLoading && totalPages > 1 && (
        <div className="bp-catalogue__pagination">
          <button
            type="button"
            className="bp-catalogue__page-btn"
            data-bp-focusable
            disabled={page <= 1}
            onClick={() => dispatch(setPage(page - 1))}
          >
            {t("catalogue_prev_page")}
          </button>
          <span className="bp-catalogue__page-current">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            className="bp-catalogue__page-btn"
            data-bp-focusable
            disabled={page >= totalPages}
            onClick={() => dispatch(setPage(page + 1))}
          >
            {t("catalogue_next_page")}
          </button>
        </div>
      )}
    </div>
  );
}
