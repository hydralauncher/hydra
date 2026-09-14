import type { SteamWebApiToken } from "./steam-store-session-config";

export class SteamWebApiHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown = null,
    public readonly retryAfterSeconds: number | null = null
  ) {
    super(`steam-web-api-http-${status}`);
    this.name = "SteamWebApiHttpError";
  }
}

export const STEAM_WEB_API_BASE_URL = "https://api.steampowered.com";

type SteamGetOptions = {
  path: string;
  token: SteamWebApiToken;
  params?: Record<string, string>;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  includeSteamId?: boolean;
};

const readJsonBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export const steamWebApiGet = async ({
  path,
  token,
  params,
  signal,
  fetchImpl = fetch,
  includeSteamId = true,
}: SteamGetOptions): Promise<unknown> => {
  const url = new URL(path, STEAM_WEB_API_BASE_URL);
  url.searchParams.set("access_token", token.accessToken);
  if (includeSteamId) {
    url.searchParams.set("steamid", token.steamId64);
  }
  url.searchParams.set("format", "json");

  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetchImpl(url, { signal });
  const body = await readJsonBody(response);

  if (!response.ok) {
    const retryAfter = response.headers.get("retry-after")?.trim();
    const retryAfterSeconds =
      retryAfter && /^\d+$/.test(retryAfter)
        ? Number.parseInt(retryAfter, 10)
        : null;

    throw new SteamWebApiHttpError(response.status, body, retryAfterSeconds);
  }

  return body;
};

export const fetchSteamOwnedGames = (
  token: SteamWebApiToken,
  signal?: AbortSignal,
  fetchImpl?: typeof fetch
) =>
  steamWebApiGet({
    path: "IPlayerService/GetOwnedGames/v1/",
    token,
    params: {
      include_appinfo: "1",
      include_played_free_games: "1",
    },
    signal,
    fetchImpl,
  });

export const fetchSteamGameAchievementSchema = (
  token: SteamWebApiToken,
  steamAppId: string,
  signal?: AbortSignal,
  fetchImpl?: typeof fetch
) =>
  steamWebApiGet({
    path: "IPlayerService/GetGameAchievements/v1/",
    token,
    params: {
      appid: steamAppId,
      language: "english",
    },
    signal,
    fetchImpl,
    includeSteamId: false,
  });

export const fetchSteamFamilyGroupForUser = (
  token: SteamWebApiToken,
  signal?: AbortSignal,
  fetchImpl?: typeof fetch
) =>
  steamWebApiGet({
    path: "IFamilyGroupsService/GetFamilyGroupForUser/v1/",
    token,
    signal,
    fetchImpl,
    includeSteamId: false,
  });

export const fetchSteamSharedLibraryApps = (
  token: SteamWebApiToken,
  familyGroupId: string,
  signal?: AbortSignal,
  fetchImpl?: typeof fetch
) =>
  steamWebApiGet({
    path: "IFamilyGroupsService/GetSharedLibraryApps/v1/",
    token,
    params: {
      family_groupid: familyGroupId,
      include_own: "0",
      include_excluded: "0",
      include_free: "0",
      include_non_games: "0",
      language: "english",
    },
    signal,
    fetchImpl,
    includeSteamId: false,
  });

export const fetchSteamFamilyPlaytimeSummary = (
  token: SteamWebApiToken,
  familyGroupId: string,
  signal?: AbortSignal,
  fetchImpl?: typeof fetch
) =>
  steamWebApiGet({
    path: "IFamilyGroupsService/GetPlaytimeSummary/v1/",
    token,
    params: {
      family_groupid: familyGroupId,
      input_json: JSON.stringify({ family_groupid: familyGroupId }),
    },
    signal,
    fetchImpl,
    includeSteamId: false,
  });

export const fetchSteamLastPlayedTimes = (
  token: SteamWebApiToken,
  signal?: AbortSignal,
  fetchImpl?: typeof fetch
) =>
  steamWebApiGet({
    path: "IPlayerService/ClientGetLastPlayedTimes/v1/",
    token,
    signal,
    fetchImpl,
    includeSteamId: false,
  });
