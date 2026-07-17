export const STEAM_GRID_DB_CACHE_CONTROL = "public, max-age=259200";

interface SteamGridDbRequestDetails {
  method: string;
  resourceType: string;
  url: string;
}

type ResponseHeaders = Record<string, string[]>;

export const isSteamGridDbArtworkRequest = ({
  method,
  resourceType,
  url,
}: SteamGridDbRequestDetails): boolean => {
  if (method.toUpperCase() !== "GET") return false;
  if (resourceType !== "image" && resourceType !== "media") return false;

  try {
    const { hostname } = new URL(url);
    return (
      hostname === "steamgriddb.com" || hostname.endsWith(".steamgriddb.com")
    );
  } catch {
    return false;
  }
};

export const addSteamGridDbCacheControl = (
  responseHeaders: ResponseHeaders | undefined
): ResponseHeaders => {
  const headersWithoutCacheControl = Object.fromEntries(
    Object.entries(responseHeaders ?? {}).filter(
      ([headerName]) => headerName.toLowerCase() !== "cache-control"
    )
  );

  return {
    ...headersWithoutCacheControl,
    "Cache-Control": [STEAM_GRID_DB_CACHE_CONTROL],
  };
};
