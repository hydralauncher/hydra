import type { DownloadSource } from "@types";

import {
  useAppDispatch,
  useAppSelector,
  useFormat,
  useRepacks,
} from "@renderer/hooks";
import { useEffect, useMemo, useRef, useState } from "react";

import "./catalogue.scss";

import { SPACING_UNIT, vars } from "@renderer/theme.css";
import { downloadSourcesTable } from "@renderer/dexie";
import { FilterSection } from "./filter-section";
import { setFilters, setPage } from "@renderer/features";
import { useTranslation } from "react-i18next";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import { Pagination } from "./pagination";
import { useCatalogue } from "@renderer/hooks/use-catalogue";
import { GameItem } from "./game-item";
import { FilterItem } from "./filter-item";

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

  const { steamDevelopers, steamPublishers } = useCatalogue();

  const { steamGenres, steamUserTags } = useAppSelector(
    (state) => state.catalogueSearch
  );

  const [downloadSources, setDownloadSources] = useState<DownloadSource[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [results, setResults] = useState<any[]>([]);

  const [itemsCount, setItemsCount] = useState(0);

  const { formatNumber } = useFormat();

  const { filters, page } = useAppSelector((state) => state.catalogueSearch);

  const dispatch = useAppDispatch();

  const { t, i18n } = useTranslation("catalogue");

  const { getRepacksForObjectId } = useRepacks();

  useEffect(() => {
    setResults([]);
    setIsLoading(true);
    abortControllerRef.current?.abort();

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    window.electron
      .searchGames(filters, PAGE_SIZE, (page - 1) * PAGE_SIZE)
      .then((response) => {
        if (abortController.signal.aborted) {
          return;
        }

        setResults(response.edges);
        setItemsCount(response.count);
        setIsLoading(false);
      });
  }, [filters, page, dispatch]);

  useEffect(() => {
    downloadSourcesTable.toArray().then((sources) => {
      setDownloadSources(sources.filter((source) => !!source.fingerprint));
    });
  }, [getRepacksForObjectId]);

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
        label: publisher,
        orbColor: filterCategoryColors.publishers,
        key: "publishers",
        value: publisher,
      })),
    ];
  }, [filters, steamUserTags, steamGenresMapping, language, downloadSources]);

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
        items: downloadSources.map((source) => ({
          label: source.name,
          value: source.fingerprint,
          checked: filters.downloadSourceFingerprints.includes(
            source.fingerprint
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
          label: publisher,
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
    <div className="catalogue">
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <ul
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              listStyle: "none",
              margin: 0,
              padding: 0,
            }}
          >
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

      <div
        style={{
          display: "flex",
          gap: SPACING_UNIT * 2,
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: "100%",
            gap: 8,
          }}
        >
          {isLoading ? (
            <SkeletonTheme
              baseColor={vars.color.darkBackground}
              highlightColor={vars.color.background}
            >
              {Array.from({ length: PAGE_SIZE }).map((_, i) => (
                <Skeleton
                  key={i}
                  style={{
                    height: 105,
                    borderRadius: 4,
                    border: `solid 1px ${vars.color.border}`,
                  }}
                />
              ))}
            </SkeletonTheme>
          ) : (
            results.map((game) => <GameItem key={game.id} game={game} />)
          )}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: 16,
            }}
          >
            <span style={{ fontSize: 12 }}>
              {t("result_count", {
                resultCount: formatNumber(itemsCount),
              })}
            </span>

            <Pagination
              page={page}
              totalPages={Math.ceil(itemsCount / PAGE_SIZE)}
              onPageChange={(page) => dispatch(setPage(page))}
            />
          </div>
        </div>

        <div className="catalogue__filters-container">
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
