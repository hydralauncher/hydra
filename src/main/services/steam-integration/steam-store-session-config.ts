const STEAM_ID_64_PATTERN = /^\d{17}$/;

export class SteamSessionRequiredError extends Error {
  constructor() {
    super("steam-session-required");
    this.name = "SteamSessionRequiredError";
  }
}

export type SteamWebApiToken = {
  steamId64: string;
  accessToken: string;
};

export type SteamStoreConfigAttributes = {
  userInfoRaw: string | null;
  storeConfigRaw: string | null;
  currentUrl: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asTrimmedString = (value: unknown): string => {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value).trim();
  }
  return "";
};

export const parseSteamStoreSessionConfig = (
  input: SteamStoreConfigAttributes
): SteamWebApiToken => {
  if (input.currentUrl.includes("/login")) {
    throw new SteamSessionRequiredError();
  }

  if (!input.userInfoRaw || !input.storeConfigRaw) {
    throw new SteamSessionRequiredError();
  }

  let userInfo: unknown;
  let storeConfig: unknown;

  try {
    userInfo = JSON.parse(input.userInfoRaw);
    storeConfig = JSON.parse(input.storeConfigRaw);
  } catch {
    throw new SteamSessionRequiredError();
  }

  if (
    !isRecord(userInfo) ||
    !isRecord(storeConfig) ||
    userInfo.logged_in !== true
  ) {
    throw new SteamSessionRequiredError();
  }

  const steamId64 = asTrimmedString(userInfo.steamid);
  const accessToken = asTrimmedString(storeConfig.webapi_token);

  if (!STEAM_ID_64_PATTERN.test(steamId64) || !accessToken) {
    throw new SteamSessionRequiredError();
  }

  return { steamId64, accessToken };
};

export type SteamCommunityPageState = {
  currentUrl: string;
  steamIdRaw: unknown;
};

// Match the login path only: vanity profile URLs such as /id/loginking/ also contain "/login".
const isSteamCommunityLoginPageUrl = (value: string) => {
  try {
    const url = new URL(value);
    return (
      url.hostname === "login.steampowered.com" ||
      url.pathname === "/login" ||
      url.pathname.startsWith("/login/")
    );
  } catch {
    return true;
  }
};

/** Reads the SteamID64 Steam Community exposes as `g_steamID` (false when logged out). */
export const parseSteamCommunityPageSteamId = (
  input: SteamCommunityPageState
): string | null => {
  if (isSteamCommunityLoginPageUrl(input.currentUrl)) return null;

  const steamId64 = asTrimmedString(input.steamIdRaw);
  return STEAM_ID_64_PATTERN.test(steamId64) ? steamId64 : null;
};

export type SteamCommunityLogin =
  | { status: "logged-in"; steamId64: string }
  | { status: "logged-out" }
  // The Community page could not be loaded, so the stored cookies are used as-is.
  | { status: "unverified" };

/**
 * `refreshed` is null when the Community page failed to load; the sync then
 * falls back to the stored cookies, as it did before the page was loaded.
 */
export const resolveSteamCommunityLogin = ({
  refreshed,
  hasLoginCookie,
}: {
  refreshed: { steamId64: string | null } | null;
  hasLoginCookie: boolean;
}): SteamCommunityLogin => {
  if (refreshed?.steamId64) {
    return { status: "logged-in", steamId64: refreshed.steamId64 };
  }
  if (refreshed || !hasLoginCookie) {
    return { status: "logged-out" };
  }
  return { status: "unverified" };
};
