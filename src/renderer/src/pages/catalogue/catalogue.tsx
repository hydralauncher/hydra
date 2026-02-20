import type {
  CatalogueSearchResult,
  CatalogueSearchPayload,
  DownloadSource,
} from "@types";

import { useAppDispatch, useAppSelector, useFormat } from "@renderer/hooks";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";

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
import { Button } from "@renderer/components/button/button";

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
  tags: "hsl(95deg 50% 20%)",
  downloadSourceFingerprints: "hsl(27deg 50% 40%)",
  developers: "hsl(340deg 50% 46%)",
  publishers: "hsl(200deg 50% 30%)",
  protondbSupportBadges: "#F50057",
  deckCompatibility: "#F50057",
};

const PAGE_SIZE = 20;

const clearAllCategoryFilters = {
  genres: [],
  tags: [],
  downloadSourceFingerprints: [],
  developers: [],
  publishers: [],
  protondbSupportBadges: [],
  deckCompatibility: [],
};

const protonCompatibilityThresholds: CompatibilityThreshold<
  CatalogueSearchPayload["protondbSupportBadges"][number]
>[] = [
  { value: "any", labelKey: "compatibility_any", values: [] },
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
  const abortControllerRef = useRef<AbortController | null>(null);
  const cataloguePageRef = useRef<HTMLDivElement>(null);

  const { steamDevelopers, steamPublishers, downloadSources } = useCatalogue();

  const { steamGenres, steamUserTags, filters, page } = useAppSelector(
    (state) => state.catalogueSearch
  );

  const [isLoading, setIsLoading] = useState(true);

  const [results, setResults] = useState<CatalogueSearchResult[]>([]);

  const [itemsCount, setItemsCount] = useState(0);

  const { formatNumber } = useFormat();

  const dispatch = useAppDispatch();

  const { t, i18n } = useTranslation("catalogue");
  const isLinux = window.electron.platform === "linux";

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

      ...(isLinux && protonThreshold && protonThreshold.values.length
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

      ...(isLinux && deckCompatible
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
    isLinux,
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

  const selectedFiltersCount = groupedFilters.length;

  const protonThresholdIndex = Math.max(
    protonCompatibilityThresholds.findIndex((threshold) =>
      areSameValues(threshold.values, filters.protondbSupportBadges)
    ),
    0
  );

  const protonThresholdValue =
    protonCompatibilityThresholds[protonThresholdIndex];
  const isDeckCompatible = areSameValues(filters.deckCompatibility, [
    "playable",
    "verified",
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
            {isLinux && (
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
                  protonValue={protonThresholdValue.value}
                  deckChecked={isDeckCompatible}
                  deckLabel={t("steam_deck_compatible")}
                  color={filterCategoryColors.protondbSupportBadges}
                  onProtonChange={(value) => {
                    const nextThreshold =
                      protonCompatibilityThresholds.find(
                        (threshold) => threshold.value === value
                      ) ?? protonCompatibilityThresholds[0];

                    dispatch(
                      setFilters({
                        protondbSupportBadges: [...nextThreshold.values],
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
          </div>
        </div>
      </div>
    </div>
  );
}
