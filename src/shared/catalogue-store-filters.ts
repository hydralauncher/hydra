export type CatalogueStore = "steam" | "epic";
export type CatalogueStoreScope = "all" | CatalogueStore;

export interface CatalogueStoreFilters {
  genres: string[];
  developers: string[];
  publishers: string[];
}

const FILTER_FIELDS = ["genres", "developers", "publishers"] as const;

export function parseCatalogueStoreScope(
  value: string | null
): CatalogueStoreScope {
  return value === "steam" || value === "epic" ? value : "all";
}

export function getCatalogueSearchShops(
  scope: CatalogueStoreScope
): CatalogueStore[] {
  return scope === "all" ? ["steam", "epic"] : [scope];
}

export async function loadCatalogueStoreFilters(
  scope: CatalogueStoreScope,
  get: (path: string) => Promise<string[]>,
  onError?: (path: string, error: unknown) => void
): Promise<CatalogueStoreFilters> {
  const requests = getCatalogueSearchShops(scope).flatMap((shop) =>
    FILTER_FIELDS.map((field) => ({
      field,
      path: `/catalogue/${shop}/${field}`,
    }))
  );
  const responses = await Promise.allSettled(
    requests.map(({ path }) => get(path))
  );
  const filters: CatalogueStoreFilters = {
    genres: [],
    developers: [],
    publishers: [],
  };

  responses.forEach((response, index) => {
    const { field, path } = requests[index];
    if (response.status === "fulfilled") {
      filters[field].push(...response.value);
    } else {
      onError?.(path, response.reason);
    }
  });

  for (const field of FILTER_FIELDS) {
    filters[field] = [
      ...new Set(filters[field].filter((value) => value.trim())),
    ].sort((first, second) => first.localeCompare(second));
  }

  return filters;
}
