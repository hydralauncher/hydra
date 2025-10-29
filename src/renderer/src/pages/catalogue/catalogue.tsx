import type {
  CatalogueSearchResult,
  CatalogueSearchPayload,
  DownloadSource,
} from "@types";

import { useAppDispatch, useAppSelector, useFormat } from "@renderer/hooks";
import { useEffect, useMemo, useRef, useState } from "react";

import "./catalogue.scss";

import { FilterSection } from "./filter-section";
import { setFilters, setPage } from "@renderer/features";
import { useTranslation } from "react-i18next";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import { Pagination } from "./pagination";
import { useCatalogue } from "@renderer/hooks/use-catalogue";
import { GameItem } from "./game-item";
import { FilterItem } from "./filter-item";
import { debounce } from "lodash-es";

const filterCategoryColors = {
  genres: "hsl(262deg 50% 47%)",
  tags: "hsl(95deg 50% 20%)",
  downloadSourceFingerprints: "hsl(27deg 50% 40%)",
  developers: "hsl(340deg 50% 46%)",
  publishers: "hsl(200deg 50% 30%)",
};

const PAGE_SIZE = 20;

export default function Catalogue() {
  const abortControllerRef = useRef<AbortController | null>(null);
  const cataloguePageRef = useRef<HTMLDivElement>(null);

  const { steamDevelopers, steamPublishers, downloadSources } = useCatalogue();

  const { steamGenres, steamUserTags } = useAppSelector(
    (state) => state.catalogueSearch
  );

  const [isLoading, setIsLoading] = useState(true);

  const [results, setResults] = useState<CatalogueSearchResult[]>([]);

  const [itemsCount, setItemsCount] = useState(0);

  const { formatNumber } = useFormat();

  const { filters, page } = useAppSelector((state) => state.catalogueSearch);

  const dispatch = useAppDispatch();

  const { t, i18n } = useTranslation("catalogue");

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
          downloadSourceIds: downloadSources.map(
            (downloadSource) => downloadSource.id
          ),
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

  const decodeHTML = (s: string) =>
    s.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">");

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

  const language = i18n.language.split("-")[0];

  const steamGenresMapping = useMemo<Record<string, string>>(() => {
    if (!steamGenres[language]) return {};

    return steamGenres[language].reduce((prev, genre, index) => {
      prev[genre] = steamGenres["en"][index];
      return prev;
    }, {});
  }, [steamGenres, language]);

  const steamGenresFilterItems = useMemo(() => {
    return Object.entries(steamGenresMapping)
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
      .map(([key, value]) => ({
        label: key,
        value: value,
        checked: filters.genres.includes(value),
      }));
  }, [steamGenresMapping, filters.genres]);

  const steamUserTagsFilterItems = useMemo(() => {
    if (!steamUserTags[language]) return [];

    return Object.entries(steamUserTags[language])
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
      .map(([key, value]) => ({
        label: key,
        value: value,
        checked: filters.tags.includes(value),
      }));
  }, [steamUserTags, filters.tags, language]);

  const groupedFilters = useMemo(() => {
    return [
      ...filters.genres.map((genre) => ({
        label: Object.keys(steamGenresMapping).find(
          (key) => steamGenresMapping[key] === genre
        ) as string,
        orbColor: filterCategoryColors.genres,
        key: "genres",
        value: genre,
      })),

      ...filters.tags.map((tag) => ({
        label: Object.keys(steamUserTags[language]).find(
          (key) => steamUserTags[language][key] === tag
        ),
        orbColor: filterCategoryColors.tags,
        key: "tags",
        value: tag,
      })),

      ...filters.downloadSourceFingerprints.map((fingerprint) => ({
        label: downloadSources.find(
          (source) => source.fingerprint === fingerprint
        )?.name as string,
        orbColor: filterCategoryColors.downloadSourceFingerprints,
        key: "downloadSourceFingerprints",
        value: fingerprint,
      })),

      ...filters.developers.map((developer) => ({
        label: developer,
        orbColor: filterCategoryColors.developers,
        key: "developers",
        value: developer,
      })),

      ...filters.publishers.map((publisher) => ({
        label: decodeHTML(publisher),
        orbColor: filterCategoryColors.publishers,
        key: "publishers",
        value: publisher,
      })),
    ];
  }, [filters, steamUserTags, downloadSources, steamGenresMapping, language]);

  const filterSections = useMemo(() => {
    return [
      {
        title: t("genres"),
        items: steamGenresFilterItems,
        key: "genres",
      },
      {
        title: t("tags"),
        items: steamUserTagsFilterItems,
        key: "tags",
      },
      {
        title: t("download_sources"),
        items: downloadSources
          .filter((source) => source.fingerprint)
          .map((source) => ({
            label: source.name,
            value: source.fingerprint!,
            checked: filters.downloadSourceFingerprints.includes(
              source.fingerprint!
            ),
          })),
        key: "downloadSourceFingerprints",
      },
      {
        title: t("developers"),
        items: steamDevelopers.map((developer) => ({
          label: developer,
          value: developer,
          checked: filters.developers.includes(developer),
        })),
        key: "developers",
      },
      {
        title: t("publishers"),
        items: steamPublishers.map((publisher) => ({
          label: decodeHTML(publisher),
          value: publisher,
          checked: filters.publishers.includes(publisher),
        })),
        key: "publishers",
      },
    ];
  }, [
    downloadSources,
    filters.developers,
    filters.downloadSourceFingerprints,
    filters.publishers,
    steamDevelopers,
    steamGenresFilterItems,
    steamPublishers,
    steamUserTagsFilterItems,
    t,
  ]);

  return (
    <div className="catalogue" ref={cataloguePageRef}>
      <div className="catalogue__header">
        <div className="catalogue__filters-wrapper">
          <ul className="catalogue__filters-list">
            {groupedFilters.map((filter) => (
              <li key={`${filter.key}-${filter.value}`}>
                <FilterItem
                  filter={filter.label ?? ""}
                  orbColor={filter.orbColor}
                  onRemove={() => {
                    dispatch(
                      setFilters({
                        [filter.key]: filters[filter.key].filter(
                          (item) => item !== filter.value
                        ),
                      })
                    );
                  }}
                />
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="catalogue__content">
        <div className="catalogue__games-container">
          {isLoading ? (
            <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
              {Array.from({ length: PAGE_SIZE }).map((_, i) => (
                <Skeleton key={i} className="catalogue__skeleton" />
              ))}
            </SkeletonTheme>
          ) : (
            results.map((game) => <GameItem key={game.id} game={game} />)
          )}

          <div className="catalogue__pagination-container">
            <span className="catalogue__result-count">
              {t("result_count", {
                resultCount: formatNumber(itemsCount),
              })}
            </span>

            <Pagination
              page={page}
              totalPages={Math.ceil(itemsCount / PAGE_SIZE)}
              onPageChange={(page) => {
                dispatch(setPage(page));
                if (cataloguePageRef.current) {
                  cataloguePageRef.current.scrollTop = 0;
                }
              }}
            />
          </div>
        </div>

        <div className="catalogue__filters-container">
          <div className="catalogue__filters-sections">
            {filterSections.map((section) => (
              <FilterSection
                key={section.key}
                title={section.title}
                onClear={() => dispatch(setFilters({ [section.key]: [] }))}
                color={filterCategoryColors[section.key]}
                onSelect={(value) => {
                  if (filters[section.key].includes(value)) {
                    dispatch(
                      setFilters({
                        [section.key]: filters[
                          section.key as
                            | "genres"
                            | "tags"
                            | "downloadSourceFingerprints"
                            | "developers"
                            | "publishers"
                        ].filter((item) => item !== value),
                      })
                    );
                  } else {
                    dispatch(
                      setFilters({
                        [section.key]: [...filters[section.key], value],
                      })
                    );
                  }
                }}
                items={section.items}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
