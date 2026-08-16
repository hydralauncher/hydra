import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  TagIcon,
  DownloadIcon,
  PeopleIcon,
  BriefcaseIcon,
  ProjectIcon,
} from "@primer/octicons-react";
import type { CatalogueSearchPayload, DownloadSource } from "@types";
import type { LaunchboxCatalogueFilters } from "@renderer/hooks/use-launchbox-filters";

interface UseSectionsParams {
  mode: "modern" | "classics";
  filters: CatalogueSearchPayload;
  language: string;
  steamGenres: Record<string, string[]>;
  steamUserTags: Record<string, Record<string, number>>;
  steamDevelopers: string[];
  steamPublishers: string[];
  downloadSources: DownloadSource[];
  launchboxFilters: LaunchboxCatalogueFilters;
}

export function useCatalogueFilterSections({
  mode,
  filters,
  language,
  steamGenres,
  steamUserTags,
  steamDevelopers,
  steamPublishers,
  downloadSources,
  launchboxFilters,
}: UseSectionsParams) {
  const { t } = useTranslation("catalogue");

  const steamGenresFilterItems = useMemo(() => {
    if (!steamGenres[language]) return [];
    return Object.entries(
      steamGenres[language].reduce(
        (acc, genre, i) => {
          acc[genre] = steamGenres["en"][i];
          return acc;
        },
        {} as Record<string, string>
      )
    )
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => ({
        label: key,
        value: val,
        checked: filters.genres.includes(val),
      }));
  }, [steamGenres, filters.genres, language]);

  const steamTagsFilterItems = useMemo(() => {
    if (!steamUserTags[language]) return [];
    return Object.entries(steamUserTags[language])
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => ({
        label: k,
        value: v,
        checked: filters.tags.includes(v),
      }));
  }, [steamUserTags, filters.tags, language]);

  const modernSections = useMemo(
    () => [
      {
        key: "genres",
        title: t("genres"),
        icon: <ProjectIcon size={12} />,
        items: steamGenresFilterItems,
      },
      {
        key: "tags",
        title: t("tags"),
        icon: <TagIcon size={12} />,
        items: steamTagsFilterItems,
      },
      {
        key: "downloadSourceFingerprints",
        title: "Fontes",
        icon: <DownloadIcon size={12} />,
        items: downloadSources.map((s) => ({
          label: s.name,
          value: s.fingerprint ?? "",
          checked:
            !!s.fingerprint &&
            filters.downloadSourceFingerprints.includes(s.fingerprint),
        })),
      },
      {
        key: "developers",
        title: "Devs",
        icon: <PeopleIcon size={12} />,
        items: steamDevelopers.map((d) => ({
          label: d,
          value: d,
          checked: filters.developers.includes(d),
        })),
      },
      {
        key: "publishers",
        title: "Publishers",
        icon: <BriefcaseIcon size={12} />,
        items: steamPublishers.map((p) => ({
          label: p,
          value: p,
          checked: filters.publishers.includes(p),
        })),
      },
    ],
    [
      steamGenresFilterItems,
      steamTagsFilterItems,
      downloadSources,
      filters.downloadSourceFingerprints,
      steamDevelopers,
      filters.developers,
      steamPublishers,
      filters.publishers,
      t,
    ]
  );

  const classicsSections = useMemo(
    () => [
      {
        key: "genres",
        title: t("genres"),
        icon: <ProjectIcon size={12} />,
        items: launchboxFilters.genres.map((g) => ({
          label: g,
          value: g,
          checked: filters.genres.includes(g),
        })),
      },
      {
        key: "downloadSourceFingerprints",
        title: "Fontes",
        icon: <DownloadIcon size={12} />,
        items: downloadSources.map((s) => ({
          label: s.name,
          value: s.fingerprint ?? "",
          checked:
            !!s.fingerprint &&
            filters.downloadSourceFingerprints.includes(s.fingerprint),
        })),
      },
      {
        key: "developers",
        title: "Devs",
        icon: <PeopleIcon size={12} />,
        items: launchboxFilters.developers.map((d) => ({
          label: d,
          value: d,
          checked: filters.developers.includes(d),
        })),
      },
      {
        key: "publishers",
        title: "Publishers",
        icon: <BriefcaseIcon size={12} />,
        items: launchboxFilters.publishers.map((p) => ({
          label: p,
          value: p,
          checked: filters.publishers.includes(p),
        })),
      },
    ],
    [
      launchboxFilters,
      downloadSources,
      filters.genres,
      filters.downloadSourceFingerprints,
      filters.developers,
      filters.publishers,
      t,
    ]
  );

  return mode === "modern" ? modernSections : classicsSections;
}
