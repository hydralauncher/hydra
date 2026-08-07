import { useEffect, useState } from "react";

import { SUPPORTED_CLASSICS_PLATFORMS } from "@shared";

export interface LaunchboxPlatform {
  key: string;
  name: string;
}

export interface LaunchboxCatalogueFilters {
  platforms: LaunchboxPlatform[];
  genres: string[];
  developers: string[];
  publishers: string[];
}

const emptyFilters: LaunchboxCatalogueFilters = {
  platforms: [],
  genres: [],
  developers: [],
  publishers: [],
};

let cachedFilters: LaunchboxCatalogueFilters | null = null;
let inflight: Promise<LaunchboxCatalogueFilters> | null = null;

const fetchLaunchboxFilters = async (): Promise<LaunchboxCatalogueFilters> => {
  if (cachedFilters) return cachedFilters;
  if (inflight) return inflight;

  inflight = window.electron.hydraApi
    .get<{
      platforms?: (LaunchboxPlatform | string)[];
      genres?: string[];
      developers?: string[];
      publishers?: string[];
    } | null>("/catalogue/filters?shop=launchbox", { needsAuth: false })
    .then((response) => {
      const normalized: LaunchboxCatalogueFilters = {
        platforms: (response?.platforms ?? [])
          .map((platform) =>
            typeof platform === "string"
              ? { key: platform, name: platform }
              : platform
          )
          .filter((platform) =>
            SUPPORTED_CLASSICS_PLATFORMS.includes(platform.key)
          ),
        genres: response?.genres ?? [],
        developers: response?.developers ?? [],
        publishers: response?.publishers ?? [],
      };
      cachedFilters = normalized;
      return normalized;
    })
    .catch(() => emptyFilters)
    .finally(() => {
      inflight = null;
    });

  return inflight;
};

export function useLaunchboxFilters(enabled: boolean) {
  const [filters, setFilters] =
    useState<LaunchboxCatalogueFilters>(emptyFilters);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    fetchLaunchboxFilters().then((result) => {
      if (!cancelled) setFilters(result);
    });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return filters;
}
