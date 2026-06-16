import type {
  CatalogueSearchPayload,
  CatalogueSearchResult,
  DownloadSource,
} from "@types";

import { useAppDispatch, useAppSelector, useFormat } from "@renderer/hooks";
import {
  lazy,
  Suspense,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import "./catalogue.scss";

import { Button } from "@renderer/components/button/button";
import { SelectField } from "@renderer/components/select-field/select-field";
import { setFilters, setPage } from "@renderer/features";
import { useCatalogue } from "@renderer/hooks/use-catalogue";
import { useLaunchboxFilters } from "@renderer/hooks/use-launchbox-filters";
import { debounce } from "lodash-es";
import { useTranslation } from "react-i18next";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import cn from "classnames";
import { CatalogueModeToggle } from "./catalogue-mode-toggle";
import { FilterItem } from "./filter-item";
import { FilterSection } from "./filter-section";
import { GameItem } from "./game-item";
import { GameItemClassics } from "./game-item-classics";
import { Pagination } from "./pagination";
import {
  ClassicsOnboardingModal,
  hasDismissedClassicsOnboarding,
} from "@renderer/components/classics-onboarding-modal/classics-onboarding-modal";

const ProtonCompatibilitySection = lazy(async () => {
  const mod = await import("./proton-compatibility-section");
  return { default: mod.ProtonCompatibilitySection };
});

const ReleaseYearSection = lazy(async () => {
  const mod = await import("./release-year-section");
  return { default: mod.ReleaseYearSection };
});

const MIN_RELEASE_YEAR = 1970;

type CompatibilityThreshold<Value extends string> = {
  value: string;
  labelKey: string;
  values: Value[];
  color?: string;
};

const filterCategoryColors = {
  genres: "hsl(262deg 50% 47%)",
  tags: "hsl(95deg 50% 20%)",
  downloadSourceFingerprints: "hsl(27deg 50% 40%)",
  developers: "hsl(340deg 50% 46%)",
  publishers: "hsl(200deg 50% 30%)",
  protondbSupportBadges: "#F50057",
  deckCompatibility: "#F50057",
  releaseYear: "hsl(38deg 50% 40%)",
  platforms: "hsl(170deg 50% 36%)",
};

const PAGE_SIZE = 30;

const clearAllCategoryFilters = {
  genres: [],
  tags: [],
  downloadSourceFingerprints: [],
  developers: [],
  publishers: [],
  protondbSupportBadges: [],
  deckCompatibility: [],
  releaseYear: undefined,
  platforms: [],
};

const sortValues = [
  "popularity:desc",
  "releaseDate:desc",
  "releaseDate:asc",
  "alphabetical:asc",
  "alphabetical:desc",
  "hydraScore:desc",
  "hydraScore:asc",
] as const;

type CatalogueSortValue = (typeof sortValues)[number];

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

const areSameValues = (first: string[], second: string[]) =>
  first.length === second.length &&
  first.every((item) => second.includes(item));

export default function Catalogue() {
  const requestSequenceRef = useRef(0);
  const hasResultsRef = useRef(false);
  const cataloguePageRef = useRef<HTMLDivElement>(null);

  const { steamDevelopers, steamPublishers, downloadSources } = useCatalogue();

  const { steamGenres, steamUserTags, filters, page, mode } = useAppSelector(
    (state) => state.catalogueSearch
  );
  const launchboxFilters = useLaunchboxFilters(mode === "classics");
  const deferredTitleFilter = useDeferredValue(filters.title);

  const effectiveFilters = useMemo(() => {
    return {
      ...filters,
      title: deferredTitleFilter,
    };
  }, [filters, deferredTitleFilter]);

  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);

  const [results, setResults] = useState<CatalogueSearchResult[]>([]);
  const [resultsMode, setResultsMode] = useState(mode);

  const [itemsCount, setItemsCount] = useState(0);

  const [showClassicsOnboarding, setShowClassicsOnboarding] = useState(false);
  const classicsOnboardingTriggeredRef = useRef(false);

  useEffect(() => {
    if (
      mode === "classics" &&
      !classicsOnboardingTriggeredRef.current &&
      !hasDismissedClassicsOnboarding()
    ) {
      classicsOnboardingTriggeredRef.current = true;
      setShowClassicsOnboarding(true);
    }
  }, [mode]);

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
        offset: number,
        requestId: number,
        mode: "modern" | "classics"
      ) => {
        const { platforms, ...restFilters } = filters;
        const baseRequest = {
          ...restFilters,
          take: pageSize,
          skip: offset,
          downloadSourceIds: downloadSources.map(
            (downloadSource) => downloadSource.id
          ),
        };

        const requestData =
          mode === "classics"
            ? {
                ...baseRequest,
                shops: ["launchbox"],
                platforms: platforms ?? [],
              }
            : baseRequest;

        try {
          const response = await window.electron.hydraApi.post<{
            edges: CatalogueSearchResult[];
            count: number;
          }>("/catalogue/search", {
            data: requestData,
            needsAuth: false,
          });

          if (requestId !== requestSequenceRef.current) return;

          setResults(response.edges);
          setResultsMode(mode);
          setItemsCount(response.count);
          setIsLoading(false);
        } finally {
          if (requestId === requestSequenceRef.current) {
            setIsFetching(false);
          }
        }
      },
      500
    )
  ).current;

  const decodeHTML = (s: string) =>
    s.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">");

  useEffect(() => {
    hasResultsRef.current = results.length > 0;
  }, [results.length]);

  const isModeTransitioning = resultsMode !== mode;
  const showSkeleton = isLoading || isModeTransitioning;

  useEffect(() => {
    const requestId = ++requestSequenceRef.current;
    setIsFetching(true);

    if (!hasResultsRef.current) {
      setIsLoading(true);
    }

    debouncedSearch(
      effectiveFilters,
      downloadSources,
      PAGE_SIZE,
      (page - 1) * PAGE_SIZE,
      requestId,
      mode
    );

    return () => {
      debouncedSearch.cancel();
    };
  }, [effectiveFilters, downloadSources, page, debouncedSearch, mode]);

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

  const classicsPlatforms = useMemo(
    () => filters.platforms ?? [],
    [filters.platforms]
  );

  const classicsFilterSections = useMemo(() => {
    return [
      {
        title: t("platforms"),
        key: "platforms" as const,
        items: launchboxFilters.platforms.map((platform) => ({
          label: platform.name,
          value: platform.key,
          checked: classicsPlatforms.includes(platform.key),
        })),
      },
      {
        title: t("genres"),
        key: "genres" as const,
        items: launchboxFilters.genres.map((genre) => ({
          label: genre,
          value: genre,
          checked: filters.genres.includes(genre),
        })),
      },
      {
        title: t("developers"),
        key: "developers" as const,
        items: launchboxFilters.developers.map((developer) => ({
          label: developer,
          value: developer,
          checked: filters.developers.includes(developer),
        })),
      },
      {
        title: t("publishers"),
        key: "publishers" as const,
        items: launchboxFilters.publishers.map((publisher) => ({
          label: decodeHTML(publisher),
          value: publisher,
          checked: filters.publishers.includes(publisher),
        })),
      },
      {
        title: t("download_sources"),
        key: "downloadSourceFingerprints" as const,
        items: downloadSources
          .filter((source) => source.fingerprint)
          .map((source) => ({
            label: source.name,
            value: source.fingerprint!,
            checked: filters.downloadSourceFingerprints.includes(
              source.fingerprint!
            ),
          })),
      },
    ];
  }, [
    launchboxFilters,
    filters.genres,
    filters.developers,
    filters.publishers,
    filters.downloadSourceFingerprints,
    downloadSources,
    classicsPlatforms,
    t,
  ]);

  const classicsGroupedFilters = useMemo(() => {
    return [
      ...classicsPlatforms.map((platform) => ({
        label:
          launchboxFilters.platforms.find((p) => p.key === platform)?.name ??
          platform,
        filterType: t("platforms"),
        orbColor: filterCategoryColors.platforms,
        key: "platforms",
        value: platform,
      })),
      ...filters.genres.map((genre) => ({
        label: genre,
        filterType: t("genres"),
        orbColor: filterCategoryColors.genres,
        key: "genres",
        value: genre,
      })),
      ...filters.developers.map((developer) => ({
        label: developer,
        filterType: t("developers"),
        orbColor: filterCategoryColors.developers,
        key: "developers",
        value: developer,
      })),
      ...filters.publishers.map((publisher) => ({
        label: decodeHTML(publisher),
        filterType: t("publishers"),
        orbColor: filterCategoryColors.publishers,
        key: "publishers",
        value: publisher,
      })),
      ...filters.downloadSourceFingerprints.map((fingerprint) => ({
        label: downloadSources.find(
          (source) => source.fingerprint === fingerprint
        )?.name as string,
        filterType: t("download_sources"),
        orbColor: filterCategoryColors.downloadSourceFingerprints,
        key: "downloadSourceFingerprints",
        value: fingerprint,
      })),
    ];
  }, [
    classicsPlatforms,
    filters.genres,
    filters.developers,
    filters.publishers,
    filters.downloadSourceFingerprints,
    downloadSources,
    launchboxFilters.platforms,
    t,
  ]);

  const groupedFilters = useMemo(() => {
    const protonThreshold = protonCompatibilityThresholds.find((threshold) =>
      areSameValues(threshold.values, filters.protondbSupportBadges)
    );
    const deckCompatible = areSameValues(filters.deckCompatibility, [
      "playable",
      "verified",
    ]);

    return [
      ...filters.genres.map((genre) => ({
        label: Object.keys(steamGenresMapping).find(
          (key) => steamGenresMapping[key] === genre
        ) as string,
        filterType: t("genres"),
        orbColor: filterCategoryColors.genres,
        key: "genres",
        value: genre,
      })),

      ...filters.tags.map((tag) => ({
        label: Object.keys(steamUserTags[language]).find(
          (key) => steamUserTags[language][key] === tag
        ),
        filterType: t("tags"),
        orbColor: filterCategoryColors.tags,
        key: "tags",
        value: tag,
      })),

      ...filters.downloadSourceFingerprints.map((fingerprint) => ({
        label: downloadSources.find(
          (source) => source.fingerprint === fingerprint
        )?.name as string,
        filterType: t("download_sources"),
        orbColor: filterCategoryColors.downloadSourceFingerprints,
        key: "downloadSourceFingerprints",
        value: fingerprint,
      })),

      ...filters.developers.map((developer) => ({
        label: developer,
        filterType: t("developers"),
        orbColor: filterCategoryColors.developers,
        key: "developers",
        value: developer,
      })),

      ...filters.publishers.map((publisher) => ({
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

      ...(filters.releaseYear
        ? [
            {
              label: `${filters.releaseYear.gte ?? MIN_RELEASE_YEAR} – ${filters.releaseYear.lte ?? new Date().getFullYear()}`,
              filterType: t("release_year"),
              orbColor: filterCategoryColors.releaseYear,
              key: "releaseYear",
              value: "range",
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

  const activeGroupedFilters =
    mode === "classics" ? classicsGroupedFilters : groupedFilters;
  const selectedFiltersCount = activeGroupedFilters.length;

  const sortOptions = useMemo(
    () => [
      {
        key: "popularity:desc",
        value: "popularity:desc",
        label: t("sort_popularity"),
      },
      {
        key: "releaseDate:desc",
        value: "releaseDate:desc",
        label: t("sort_newest"),
      },
      {
        key: "releaseDate:asc",
        value: "releaseDate:asc",
        label: t("sort_oldest"),
      },
      {
        key: "alphabetical:asc",
        value: "alphabetical:asc",
        label: t("sort_title_asc"),
      },
      {
        key: "alphabetical:desc",
        value: "alphabetical:desc",
        label: t("sort_title_desc"),
      },
      {
        key: "hydraScore:desc",
        value: "hydraScore:desc",
        label: t("sort_highest_rating"),
      },
      {
        key: "hydraScore:asc",
        value: "hydraScore:asc",
        label: t("sort_lowest_rating"),
      },
    ],
    [t]
  );

  const selectedSortValue = `${filters.sortBy}:${filters.sortOrder}`;

  const protonThresholdValue =
    protonCompatibilityThresholds.find((threshold) =>
      areSameValues(threshold.values, filters.protondbSupportBadges)
    )?.value ?? "";
  const isDeckCompatible = areSameValues(filters.deckCompatibility, [
    "playable",
    "verified",
  ]);

  return (
    <div className="catalogue" ref={cataloguePageRef}>
      <ClassicsOnboardingModal
        visible={showClassicsOnboarding}
        onClose={() => setShowClassicsOnboarding(false)}
      />
      <div className="catalogue__header">
        <div className="catalogue__header-row">
          <div className="catalogue__header-summary">
            <span className="catalogue__result-count">
              {t("result_count", {
                resultCount: formatNumber(itemsCount),
              })}
            </span>
            {selectedFiltersCount === 0 && (
              <span className="catalogue__filters-hint">
                {t("filters_sidebar_hint")}
              </span>
            )}
          </div>

          <div className="catalogue__sort-inline">
            <span className="catalogue__sort-label">{t("sort_by")}</span>
            <SelectField
              theme="dark"
              className="catalogue__sort-select"
              value={
                sortValues.includes(selectedSortValue as CatalogueSortValue)
                  ? selectedSortValue
                  : "popularity:desc"
              }
              options={sortOptions}
              onChange={(event) => {
                const [sortBy, sortOrder] = event.target.value.split(":") as [
                  CatalogueSearchPayload["sortBy"],
                  CatalogueSearchPayload["sortOrder"],
                ];

                dispatch(setFilters({ sortBy, sortOrder }));
              }}
            />
          </div>
        </div>

        {selectedFiltersCount > 0 && (
          <div className="catalogue__header-row catalogue__header-row--filters">
            <span className="catalogue__active-filters-label">
              {t("active_filters")}
            </span>

            <div className="catalogue__filters-wrapper">
              <ul className="catalogue__filters-list">
                {activeGroupedFilters.map((filter) => (
                  <li key={`${filter.key}-${filter.value}`}>
                    <FilterItem
                      filter={filter.label ?? ""}
                      filterType={filter.filterType}
                      orbColor={filter.orbColor}
                      onRemove={() => {
                        if (filter.value === "range") {
                          dispatch(setFilters({ releaseYear: undefined }));
                          return;
                        }

                        if (filter.value === "threshold") {
                          dispatch(setFilters({ [filter.key]: [] }));
                          return;
                        }

                        const currentValues =
                          (filters[filter.key] as
                            | (string | number)[]
                            | undefined) ?? [];

                        dispatch(
                          setFilters({
                            [filter.key]: currentValues.filter(
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
          </div>
        )}
      </div>

      <div className="catalogue__content">
        <div
          className={cn("catalogue__games-container", {
            "catalogue__games-container--classics": mode === "classics",
          })}
        >
          {showSkeleton ? (
            <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
              {Array.from({ length: PAGE_SIZE }).map((_, i) => (
                <Skeleton
                  key={i}
                  className={cn("catalogue__skeleton", {
                    "catalogue__skeleton--classics": mode === "classics",
                  })}
                />
              ))}
            </SkeletonTheme>
          ) : mode === "classics" ? (
            results.map((game) => (
              <GameItemClassics key={game.id} game={game} />
            ))
          ) : (
            results.map((game) => <GameItem key={game.id} game={game} />)
          )}

          {isFetching && !showSkeleton && (
            <span className="catalogue__result-count">{t("loading")}</span>
          )}

          <div className="catalogue__pagination-container">
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
            <CatalogueModeToggle />

            {mode === "modern" && shouldShowProtonFeatures && (
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

            {mode === "modern" && (
              <Suspense fallback={null}>
                <ReleaseYearSection
                  title={t("release_year")}
                  color={filterCategoryColors.releaseYear}
                  value={filters.releaseYear}
                  onChange={(value) =>
                    dispatch(setFilters({ releaseYear: value }))
                  }
                />
              </Suspense>
            )}

            {mode === "modern" &&
              filterSections.map((section) => (
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
                              | "protondbSupportBadges"
                              | "deckCompatibility"
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

            {mode === "classics" &&
              classicsFilterSections.map((section) => {
                const currentValues =
                  section.key === "platforms"
                    ? classicsPlatforms
                    : (filters[section.key] as string[]);

                return (
                  <FilterSection
                    key={section.key}
                    title={section.title}
                    onClear={() => dispatch(setFilters({ [section.key]: [] }))}
                    color={filterCategoryColors[section.key]}
                    onSelect={(value) => {
                      const stringValue = String(value);
                      const next = currentValues.includes(stringValue)
                        ? currentValues.filter((item) => item !== stringValue)
                        : [...currentValues, stringValue];

                      dispatch(setFilters({ [section.key]: next }));
                    }}
                    items={section.items}
                  />
                );
              })}
          </div>
        </div>
      </div>
    </div>
  );
}
