import type { SteamSourceAchievement, SteamSourceLibraryGame } from "@types";

const STEAM_APP_ID_PATTERN = /^[1-9]\d{0,9}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readArray = (value: unknown): unknown[] | null =>
  Array.isArray(value) ? value : null;

const extractNamedArray = (
  payload: unknown,
  directKey: string,
  nested: [string, string]
): unknown[] => {
  const direct = readArray(payload);
  if (direct) return direct;

  if (!isRecord(payload)) {
    return [];
  }

  const fromKey = readArray(payload[directKey]);
  if (fromKey) return fromKey;

  const nestedRoot = payload[nested[0]];
  if (isRecord(nestedRoot)) {
    const fromNested = readArray(nestedRoot[nested[1]]);
    if (fromNested) return fromNested;
  }

  return [];
};

const readIdString = (value: unknown): string | null => {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
};

const readNonNegativeInt = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }
  return null;
};

const unixSecondsToIso = (value: unknown): string | null => {
  const unix = readNonNegativeInt(value);
  if (unix == null || unix === 0) return null;
  return new Date(unix * 1000).toISOString();
};

const parseLastPlayedAt = (item: Record<string, unknown>): string | null => {
  if (typeof item.lastPlayedAt === "string") return item.lastPlayedAt;
  if (item.lastPlayedAt === null) return null;
  return unixSecondsToIso(item.rtime_last_played);
};

const parseUnlockTime = (item: Record<string, unknown>): string | null => {
  if (typeof item.unlockTime === "string") return item.unlockTime;
  if (item.unlockTime === null) return null;
  return unixSecondsToIso(item.unlocktime);
};

const STEAM_SKIP_TITLE_PATTERN =
  /\b(?:demo|(?:play|public|closed|open|technical)[\s-]*test|test[\s-]*(?:server|client)|beta|ptb)\b/i;

export const isSkippedSteamLibraryTitle = (name: string): boolean =>
  STEAM_SKIP_TITLE_PATTERN.test(name.trim());

const readSteamPlayTimeInSeconds = (item: Record<string, unknown>): number => {
  const explicitSeconds = readNonNegativeInt(item.playTimeInSeconds);
  if (explicitSeconds != null) {
    return explicitSeconds;
  }

  const foreverMinutes = readNonNegativeInt(item.playtime_forever) ?? 0;
  const disconnectedMinutes =
    readNonNegativeInt(item.playtime_disconnected) ?? 0;
  return (foreverMinutes + disconnectedMinutes) * 60;
};

const parseLibraryGame = (item: unknown): SteamSourceLibraryGame | null => {
  if (!isRecord(item)) return null;

  const steamAppId = readIdString(item.steamAppId) ?? readIdString(item.appid);
  if (!steamAppId || !STEAM_APP_ID_PATTERN.test(steamAppId)) {
    return null;
  }

  const lastPlayedAt = parseLastPlayedAt(item);

  return {
    steamAppId,
    name: typeof item.name === "string" ? item.name : "",
    playTimeInSeconds: readSteamPlayTimeInSeconds(item),
    lastPlayedAt,
  };
};

const parseAchievement = (item: unknown): SteamSourceAchievement | null => {
  if (!isRecord(item)) return null;

  const name = readIdString(item.name) ?? readIdString(item.apiname);
  if (!name) return null;

  const unlocked =
    typeof item.unlocked === "boolean"
      ? item.unlocked
      : item.achieved === 1 || item.achieved === true;

  const unlockTime = parseUnlockTime(item);

  return { name, unlocked, unlockTime };
};

export const parseSteamSourceLibrary = (
  payload: unknown
): SteamSourceLibraryGame[] =>
  extractNamedArray(payload, "games", ["response", "games"]).flatMap((item) => {
    const game = parseLibraryGame(item);
    return game ? [game] : [];
  });

export const parseSteamSourceAchievements = (
  payload: unknown
): SteamSourceAchievement[] =>
  extractNamedArray(payload, "achievements", [
    "playerstats",
    "achievements",
  ]).flatMap((item) => {
    const achievement = parseAchievement(item);
    return achievement ? [achievement] : [];
  });
