import type {
  CatalogueSearchResult,
  CatalogueSearchPayload,
  DownloadSource,
} from "@types";

import { useAppDispatch, useAppSelector, useFormat } from "@renderer/hooks";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";

import "./catalogue.scss";

import { FilterSection } from "./filter-section";
import { setFilters } from "@renderer/features";
import { useTranslation } from "react-i18next";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import { useCatalogue } from "@renderer/hooks/use-catalogue";
import { GameItem } from "./game-item";
import { FilterItem } from "./filter-item";
import { Pagination } from "./pagination";
import { debounce } from "lodash-es";
import { Button, DropdownMenu } from "@renderer/components";
import { ChevronDown } from "lucide-react";
import { CatalogueCategory } from "@shared";

const ProtonCompatibilitySection = lazy(async () => {
  const mod = await import("./proton-compatibility-section");
  return { default: mod.ProtonCompatibilitySection };
});

type CompatibilityThreshold<Value extends string> = {
  value: string;
  labelKey: string;
  values: Value[];
  color?: string;
};

const filterCategoryColors = {
  genres: "hsl(262deg 50% 47%)",
  reviewCount: "hsl(262deg 50% 47%)",
  tags: "hsl(95deg 50% 20%)",
  downloadSourceFingerprints: "hsl(27deg 50% 40%)",
  developers: "hsl(340deg 50% 46%)",
  publishers: "hsl(200deg 50% 30%)",
  protondbSupportBadges: "#F50057",
  deckCompatibility: "#F50057",
};

const PAGE_SIZE = 100;

const clearAllCategoryFilters = {
  genres: [],
  tags: [],
  downloadSourceFingerprints: [],
  developers: [],
  publishers: [],
  protondbSupportBadges: [],
  deckCompatibility: [],
  reviewCount: 0,
};

const protonCompatibilityThresholds: CompatibilityThreshold<
  CatalogueSearchPayload["protondbSupportBadges"][number]
>[] = [
    {
      value: "silver_plus",
      labelKey: "protondb_silver_plus",
      values: ["silver", "gold", "platinum"],
      color: "rgb(166, 166, 166)",
    },
    {
      value: "gold_plus",
      labelKey: "protondb_gold_plus",
      values: ["gold", "platinum"],
      color: "rgb(207, 181, 59)",
    },
    {
      value: "platinum_only",
      labelKey: "protondb_platinum_only",
      values: ["platinum"],
      color: "rgb(180, 199, 220)",
    },
  ];

const areSameValues = (
  first: string[] | undefined,
  second: string[] | undefined
) => {
  if (!first || !second) return first === second;
  return (
    first.length === second.length &&
    first.every((item) => second.includes(item))
  );
};

export default function Catalogue() {
  const abortControllerRef = useRef<AbortController | null>(null);
  const cataloguePageRef = useRef<HTMLDivElement>(null);

  const {
    steamDevelopers = [],
    steamPublishers = [],
    downloadSources = [],
  } = useCatalogue();

  const {
    steamGenres = {},
    steamUserTags = {},
    filters = {} as CatalogueSearchPayload,
  } = useAppSelector((state) => state.catalogueSearch || {});

  const [isLoading, setIsLoading] = useState(true);
  const [isDeepLoading, setIsDeepLoading] = useState(false);
  const [results, setResults] = useState<CatalogueSearchResult[]>([]);
  const [itemsCount, setItemsCount] = useState(0);
  const [deepBatch, setDeepBatch] = useState(0);

  const VIRTUAL_PAGE_SIZE = 50;
  const [localPage, setLocalPage] = useState(1);

  const statsQueue = useRef<Set<string>>(new Set());

  useEffect(() => {
    const fetchNextBatch = async () => {
      const itemsToFetch = results
        .filter((r) => !r.downloadCount && !statsQueue.current.has(r.objectId))
        .slice(0, 20);

      if (itemsToFetch.length === 0) return;

      itemsToFetch.forEach((r) => statsQueue.current.add(r.objectId));

      try {
        const statsResults = await Promise.all(
          itemsToFetch.map((r) =>
            window.electron
              .getGameStats(r.objectId, r.shop)
              .then((s) => ({ objectId: r.objectId, stats: s }))
          )
        );

        setResults((prev) => {
          const newResults = [...prev];
          statsResults.forEach(({ objectId, stats }) => {
            const index = newResults.findIndex((r) => r.objectId === objectId);
            if (index !== -1 && stats) {
              newResults[index] = {
                ...newResults[index],
                downloadCount: stats.downloadCount,
                playerCount: stats.playerCount,
              };
            }
          });
          return newResults;
        });
      } catch (e) {
        console.error("Failed to fetch stats batch", e);
      }
    };

    const timer = setInterval(fetchNextBatch, 500);
    return () => clearInterval(timer);
  }, [results]);

  const { formatNumber } = useFormat();

  const dispatch = useAppDispatch();

  const { t, i18n } = useTranslation("catalogue");
  const shouldShowProtonFeatures = window.electron.platform === "linux";

  const debouncedSearch = useRef(
    debounce(
      async (
        filters: CatalogueSearchPayload,
        downloadSources: DownloadSource[],
        pageSize: number,
        batch: number,
        append: boolean = false
      ) => {
        if (!append) {
          setIsLoading(true);
          setResults([]);
        } else {
          setIsDeepLoading(true);
        }

        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        try {
          const pagesPerBatch = 10;
          const startPage = batch * pagesPerBatch;

          const fetchPage = (pageIndex: number) =>
            window.electron.hydraApi.post<{
              edges: CatalogueSearchResult[];
              count: number;
            }>("/catalogue/search", {
              data: {
                ...filters,
                sortBy:
                  filters.sortBy === "weekly_top" ||
                    filters.sortBy === "most_downloaded" ||
                    filters.sortBy === "most_played" ||
                    filters.sortBy === "popularity"
                    ? "popularity"
                    : filters.sortBy,
                take: pageSize,
                skip: pageIndex * pageSize,
                downloadSourceIds: downloadSources.map((ds) => ds.id),
              },
              needsAuth: false,
            });

          const promises = Array.from({ length: pagesPerBatch }).map((_, i) =>
            fetchPage(startPage + i)
          );

          if (batch === 0 && !filters.title) {
            const extraSeeds = [
              window.electron.hydraApi.get<CatalogueSearchResult[]>(
                `/catalogue/${CatalogueCategory.Weekly}`,
                {
                  params: {
                    take: 100,
                    skip: 0,
                    downloadSourceIds: downloadSources.map((ds) => ds.id),
                  },
                  needsAuth: false,
                }
              ),
            ];

            const [responses, weeklySeedResults] = await Promise.all([
              Promise.all(promises),
              extraSeeds[0],
            ]);

            if (abortController.signal.aborted) return;

            const newEdges: CatalogueSearchResult[] = [];
            const seedEdges: CatalogueSearchResult[] = [];
            let totalCount = 0;

            responses.forEach((response) => {
              if (response && response.edges) {
                newEdges.push(...response.edges);
                totalCount = Math.max(totalCount, response.count || 0);
              }
            });

            if (Array.isArray(weeklySeedResults)) {
              seedEdges.push(
                ...weeklySeedResults.map((item) => ({ ...item, isWeekly: true }))
              );
            }

            setResults((prev) => {
              const uniqueMap = new Map();
              if (append) {
                prev.forEach((item) => uniqueMap.set(item.objectId, item));
              }

              seedEdges.forEach((item) => {
                const existing = uniqueMap.get(item.objectId);
                uniqueMap.set(item.objectId, {
                  ...existing,
                  ...item,
                  isWeekly: item.isWeekly || existing?.isWeekly,
                });
              });

              newEdges.forEach((item) => {
                const existing = uniqueMap.get(item.objectId);
                uniqueMap.set(item.objectId, {
                  ...existing,
                  ...item,
                  isWeekly: existing?.isWeekly,
                });
              });

              return Array.from(uniqueMap.values());
            });

            setItemsCount(totalCount);
            return;
          }

          const responses = await Promise.all(promises);

          if (abortController.signal.aborted) return;

          const newEdges: CatalogueSearchResult[] = [];
          let totalCount = 0;

          responses.forEach((response) => {
            if (response && response.edges) {
              newEdges.push(...response.edges);
              totalCount = Math.max(totalCount, response.count || 0);
            }
          });

          setResults((prev) => {
            const pool = append ? [...prev, ...newEdges] : newEdges;
            const uniqueMap = new Map();
            pool.forEach(item => uniqueMap.set(item.objectId, item));
            return Array.from(uniqueMap.values());
          });

          setItemsCount(totalCount);

        } catch (error) {
          console.error("Failed to fetch catalogue results:", error);
          if (!append) {
            setResults([]);
            setItemsCount(0);
          }
        } finally {
          if (!abortController.signal.aborted) {
            setIsLoading(false);
            setIsDeepLoading(false);
          }
        }
      },
      500
    )
  ).current;

  const decodeHTML = (s: string) => {
    if (typeof s !== "string") return "";
    return s
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">");
  };

  const sortedResults = useMemo(() => {
    return [...results].sort((a, b) => {
      if (filters.sortBy === "popularity") {
        return (b.reviewCount || 0) - (a.reviewCount || 0);
      }
      if (filters.sortBy === "weekly_top") {
        if (a.isWeekly && !b.isWeekly) return -1;
        if (!a.isWeekly && b.isWeekly) return 1;
        return (b.reviewCount || 0) - (a.reviewCount || 0);
      }
      if (filters.sortBy === "most_downloaded") {
        const diff = (b.downloadCount || 0) - (a.downloadCount || 0);
        if (diff !== 0) return diff;
        return (b.reviewCount || 0) - (a.reviewCount || 0);
      }
      if (filters.sortBy === "most_played") {
        const diff = (b.playerCount || 0) - (a.playerCount || 0);
        if (diff !== 0) return diff;
        return (b.reviewCount || 0) - (a.reviewCount || 0);
      }
      if (filters.sortBy === "reviewScore") {
        return (b.averageReviewScore || 0) - (a.averageReviewScore || 0);
      }
      return 0;
    });
  }, [results, filters.sortBy]);

  const paginatedResults = useMemo(() => {
    const start = (localPage - 1) * VIRTUAL_PAGE_SIZE;
    return sortedResults.slice(start, start + VIRTUAL_PAGE_SIZE);
  }, [sortedResults, localPage]);

  useEffect(() => {
    setLocalPage(1);
  }, [results.length, filters.sortBy]);

  const lastFullFiltersRef = useRef<string | null>(null);

  useEffect(() => {
    const currentFullFilters = JSON.stringify({
      ...filters,
      sortBy: undefined,
    });

    const filtersChanged = currentFullFilters !== lastFullFiltersRef.current;
    lastFullFiltersRef.current = currentFullFilters;

    const isLocalSortCompatible =
      filters.sortBy === "popularity" ||
      filters.sortBy === "weekly_top" ||
      filters.sortBy === "most_downloaded" ||
      filters.sortBy === "most_played";

    if (!filtersChanged && isLocalSortCompatible && results.length > 0) {
      return;
    }

    abortControllerRef.current?.abort();
    setDeepBatch(0);

    debouncedSearch(
      filters,
      downloadSources,
      PAGE_SIZE,
      0,
      false
    );

    return () => {
      debouncedSearch.cancel();
    };
  }, [filters, downloadSources, debouncedSearch]);

  const handleLoadMore = () => {
    const nextBatch = deepBatch + 1;
    setDeepBatch(nextBatch);
    debouncedSearch(
      filters,
      downloadSources,
      PAGE_SIZE,
      nextBatch,
      true
    );
  };

  const language = i18n.language.split("-")[0];


  const steamGenresMapping = useMemo<Record<string, string>>(() => {
    if (!steamGenres || !steamGenres[language]) return {};

    return steamGenres[language].reduce(
      (prev, genre, index) => {
        const enGenre = steamGenres["en"]?.[index];
        if (enGenre) {
          prev[genre] = enGenre;
        } else {
          prev[genre] = genre;
        }
        return prev;
      },
      {} as Record<string, string>
    );
  }, [steamGenres, language]);

  const steamGenresFilterItems = useMemo(() => {
    return Object.entries(steamGenresMapping)
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
      .map(([key, value]) => ({
        label: key,
        value: value,
        checked: (filters.genres || []).includes(value),
      }));
  }, [steamGenresMapping, filters.genres]);

  const steamUserTagsFilterItems = useMemo(() => {
    if (!steamUserTags || !steamUserTags[language]) return [];

    return Object.entries(steamUserTags[language])
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
      .map(([key, value]) => ({
        label: key,
        value: value,
        checked: (filters.tags || []).includes(value),
      }));
  }, [steamUserTags, filters.tags, language]);

  const groupedFilters = useMemo(() => {
    const protonThreshold = protonCompatibilityThresholds.find((threshold) =>
      areSameValues(threshold.values, filters?.protondbSupportBadges || [])
    );
    const deckCompatible = areSameValues(filters?.deckCompatibility || [], [
      "playable",
      "verified",
    ]);

    return [
      ...(filters?.genres || []).map((genre) => ({
        label: (Object.keys(steamGenresMapping).find(
          (key) => steamGenresMapping[key] === genre
        ) || genre) as string,
        filterType: t("genres"),
        orbColor: filterCategoryColors.genres,
        key: "genres",
        value: genre,
      })),

      ...(filters?.tags || []).map((tag) => ({
        label:
          Object.keys((steamUserTags && steamUserTags[language]) || {}).find(
            (key) =>
              ((steamUserTags && steamUserTags[language]) || {})[key] === tag
          ) || String(tag),
        filterType: t("tags"),
        orbColor: filterCategoryColors.tags,
        key: "tags",
        value: tag,
      })),

      ...(filters?.downloadSourceFingerprints || []).map((fingerprint) => ({
        label: (downloadSources.find(
          (source) => source.fingerprint === fingerprint
        )?.name || fingerprint) as string,
        filterType: t("download_sources"),
        orbColor: filterCategoryColors.downloadSourceFingerprints,
        key: "downloadSourceFingerprints",
        value: fingerprint,
      })),

      ...(filters?.developers || []).map((developer) => ({
        label: developer,
        filterType: t("developers"),
        orbColor: filterCategoryColors.developers,
        key: "developers",
        value: developer,
      })),

      ...(filters?.publishers || []).map((publisher) => ({
        label: decodeHTML(publisher),
        filterType: t("publishers"),
        orbColor: filterCategoryColors.publishers,
        key: "publishers",
        value: publisher,
      })),

      ...(shouldShowProtonFeatures &&
        protonThreshold &&
        protonThreshold.values.length
        ? [
          {
            label: t(protonThreshold.labelKey),
            filterType: t("protondb"),
            orbColor: filterCategoryColors.protondbSupportBadges,
            key: "protondbSupportBadges",
            value: "threshold",
          },
        ]
        : []),

      ...(shouldShowProtonFeatures && deckCompatible
        ? [
          {
            label: t("steam_deck_compatible"),
            filterType: t("steam_deck_minimum"),
            orbColor: filterCategoryColors.deckCompatibility,
            key: "deckCompatibility",
            value: "threshold",
          },
        ]
        : []),
    ];
  }, [
    filters,
    steamUserTags,
    downloadSources,
    steamGenresMapping,
    language,
    shouldShowProtonFeatures,
    t,
  ]);

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
            checked: (filters.downloadSourceFingerprints || []).includes(
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
          checked: (filters.developers || []).includes(developer),
        })),
        key: "developers",
      },
      {
        title: t("publishers"),
        items: steamPublishers.map((publisher) => ({
          label: decodeHTML(publisher),
          value: publisher,
          checked: (filters.publishers || []).includes(publisher),
        })),
        key: "publishers",
      },
    ];
  }, [
    filters.publishers,
    filters.sortBy,
    filters.reviewCount,
    steamDevelopers,
    steamGenresFilterItems,
    steamPublishers,
    steamUserTagsFilterItems,
    t,
  ]);

  const protonThresholdValue =
    protonCompatibilityThresholds.find((threshold) =>
      areSameValues(threshold.values, filters.protondbSupportBadges || [])
    )?.value ?? "";
  const isDeckCompatible = areSameValues(filters.deckCompatibility || [], [
    "playable",
    "verified",
  ]);

  const selectedFiltersCount = groupedFilters.length;

  return (
    <div className="catalogue" ref={cataloguePageRef}>
      <div className="catalogue__header">
        <div className="catalogue__filters-wrapper">
          <ul className="catalogue__filters-list">
            {groupedFilters.map((filter) => (
              <li key={`${filter.key}-${filter.value}`}>
                <FilterItem
                  filter={filter.label ?? ""}
                  filterType={filter.filterType}
                  orbColor={filter.orbColor}
                  onRemove={() => {
                    if (filter.value === "threshold") {
                      dispatch(setFilters({ [filter.key]: [] }));
                      return;
                    }

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

        {selectedFiltersCount > 0 && (
          <Button
            type="button"
            theme="outline"
            className="catalogue__clear-all-button"
            onClick={() => dispatch(setFilters(clearAllCategoryFilters))}
          >
            {t("clear_filters", {
              filterCount: formatNumber(selectedFiltersCount),
            })}
          </Button>
        )}
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
            <>
              <div className="catalogue__games-grid">
                {paginatedResults.map((game) => (
                  <GameItem key={game.objectId} game={game} />
                ))}
              </div>

              <div className="catalogue__pagination-container">
                <Pagination
                  page={localPage}
                  totalPages={Math.ceil(sortedResults.length / VIRTUAL_PAGE_SIZE)}
                  onPageChange={(page) => {
                    setLocalPage(page);
                    cataloguePageRef.current?.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                />

                {results.length < itemsCount && (
                  <Button
                    type="button"
                    theme="outline"
                    onClick={handleLoadMore}
                    disabled={isDeepLoading || isLoading}
                    className="catalogue__load-more-button"
                  >
                    {isDeepLoading ? t("loading") : t("load_more")}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>

        <div className="catalogue__filters-container">
          <div className="catalogue__sort-section">
            <DropdownMenu
              title={t("sort_by")}
              items={[
                {
                  label: t("most_reviewed"),
                  onClick: () => dispatch(setFilters({ sortBy: "popularity" })),
                },
                {
                  label: t("weekly_top"),
                  onClick: () => dispatch(setFilters({ sortBy: "weekly_top" })),
                },
                {
                  label: t("most_downloaded"),
                  onClick: () => dispatch(setFilters({ sortBy: "most_downloaded" })),
                },
                {
                  label: t("most_played"),
                  onClick: () => dispatch(setFilters({ sortBy: "most_played" })),
                }
              ]}
            >
              <Button
                type="button"
                theme="outline"
                className="catalogue__sort-button"
              >
                {t("sort_by")}: {t(
                  filters.sortBy === "popularity"
                    ? "most_reviewed"
                    : filters.sortBy === "trending"
                      ? "trending"
                      : filters.sortBy === "weekly_top"
                        ? "weekly_top"
                        : filters.sortBy === "most_downloaded"
                          ? "most_downloaded"
                          : filters.sortBy === "most_played"
                            ? "most_played"
                            : ""
                )}
                <ChevronDown size={16} />
              </Button>
            </DropdownMenu>
          </div>
          <div className="catalogue__filters-sections">
            {shouldShowProtonFeatures && (
              <Suspense fallback={null}>
                <ProtonCompatibilitySection
                  title={t("protondb")}
                  protonSliderLabel={t("protondb_minimum")}
                  deckSliderLabel={t("steam_deck_minimum")}
                  protonOptions={protonCompatibilityThresholds.map(
                    (threshold) => ({
                      value: threshold.value,
                      label: t(threshold.labelKey),
                      color: threshold.color,
                    })
                  )}
                  protonValue={protonThresholdValue}
                  deckChecked={isDeckCompatible}
                  deckLabel={t("steam_deck_compatible")}
                  color={filterCategoryColors.protondbSupportBadges}
                  onProtonChange={(value) => {
                    const nextThreshold = protonCompatibilityThresholds.find(
                      (threshold) => threshold.value === value
                    );

                    dispatch(
                      setFilters({
                        protondbSupportBadges: nextThreshold
                          ? [...nextThreshold.values]
                          : [],
                      })
                    );
                  }}
                  onDeckChange={(checked) => {
                    dispatch(
                      setFilters({
                        deckCompatibility: checked
                          ? ["playable", "verified"]
                          : [],
                      })
                    );
                  }}
                />
              </Suspense>
            )}

            {filterSections.map((section) => (
              <FilterSection
                key={section.key}
                title={section.title}
                onClear={() => dispatch(setFilters({ [section.key]: [] }))}
                color={filterCategoryColors[section.key]}
                onSelect={(value) => {
                  if (section.key === "reviewCount") {
                    const nextValue = Number(value);
                    dispatch(
                      setFilters({
                        reviewCount: filters.reviewCount === nextValue ? 0 : nextValue,
                      })
                    );
                    return;
                  }

                  if ((filters[section.key] || []).includes(value)) {
                    dispatch(
                      setFilters({
                        [section.key]: (
                          filters[
                          section.key as
                          | "genres"
                          | "tags"
                          | "downloadSourceFingerprints"
                          | "developers"
                          | "publishers"
                          | "protondbSupportBadges"
                          | "deckCompatibility"
                          ] || []
                        ).filter((item: any) => item !== value),
                      })
                    );
                  } else {
                    dispatch(
                      setFilters({
                        [section.key]: [...(filters[section.key] || []), value],
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
