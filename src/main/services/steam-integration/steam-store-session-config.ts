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
