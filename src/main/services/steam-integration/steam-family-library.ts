import type { SteamSourceLibraryGame } from "@types";

const STEAM_APP_ID_PATTERN = /^[1-9]\d{0,9}$/;
const STEAM_FAMILY_GAME_APP_TYPE = 1;

export type SteamFamilySharedApp = {
  steamAppId: string;
  name: string;
  playTimeInSeconds: number;
  lastPlayedAt: string | null;
};

export type SteamFamilyPlaytime = {
  playTimeInSeconds: number;
  lastPlayedAt: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readArray = (value: unknown): unknown[] | null =>
  Array.isArray(value) ? value : null;

const readResponse = (payload: unknown): Record<string, unknown> | null => {
  if (!isRecord(payload)) return null;
  if (isRecord(payload.response)) return payload.response;
  return payload;
};

const readIdString = (value: unknown): string | null => {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
};

const readSteamId64 = (value: unknown): string | null => {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return null;
};

const minutesToSeconds = (value: unknown): number => {
  const minutes = readNonNegativeInt(value);
  if (minutes == null) return 0;
  return minutes * 60;
};

const readNonNegativeInt = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.trunc(parsed);
    }
  }
  return null;
};

const unixSecondsToIso = (value: unknown): string | null => {
  const unix = readNonNegativeInt(value);
  if (unix == null || unix === 0) return null;
  return new Date(unix * 1000).toISOString();
};

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

const belongsToConnectedAccount = (
  item: Record<string, unknown>,
  steamId64: string
): boolean => {
  const rawSteamId = item.steamid ?? item.steam_id;
  if (rawSteamId == null) {
    return true;
  }

  const steamId = readSteamId64(rawSteamId);
  if (!steamId) {
    return true;
  }

  return steamId === steamId64;
};

export const parseSteamFamilyGroupId = (payload: unknown): string | null => {
  const response = readResponse(payload);
  if (!response) return null;

  if (response.is_not_member_of_any_group === true) {
    return null;
  }

  const familyGroupId = readIdString(response.family_groupid);
  if (!familyGroupId || familyGroupId === "0") {
    return null;
  }

  return familyGroupId;
};

const isShareableFamilyGame = (item: Record<string, unknown>): boolean => {
  const excludeReason = readNonNegativeInt(item.exclude_reason);
  if (excludeReason != null && excludeReason !== 0) {
    return false;
  }

  const appType = readNonNegativeInt(item.app_type);
  if (appType != null && appType !== STEAM_FAMILY_GAME_APP_TYPE) {
    return false;
  }

  return true;
};

const parseSharedLibraryApp = (item: unknown): SteamFamilySharedApp | null => {
  if (!isRecord(item) || !isShareableFamilyGame(item)) {
    return null;
  }

  const steamAppId = readIdString(item.steamAppId) ?? readIdString(item.appid);
  if (!steamAppId || !STEAM_APP_ID_PATTERN.test(steamAppId)) {
    return null;
  }

  const name = typeof item.name === "string" ? item.name.trim() : "";
  if (!name) {
    return null;
  }

  return {
    steamAppId,
    name,
    playTimeInSeconds: minutesToSeconds(item.rt_playtime),
    lastPlayedAt: unixSecondsToIso(item.rt_last_played),
  };
};

export const parseSteamSharedLibraryApps = (
  payload: unknown
): SteamFamilySharedApp[] =>
  extractNamedArray(payload, "apps", ["response", "apps"]).flatMap((item) => {
    const app = parseSharedLibraryApp(item);
    return app ? [app] : [];
  });

const readPlayTimeInSeconds = (item: Record<string, unknown>): number => {
  const seconds =
    readNonNegativeInt(item.seconds) ?? readNonNegativeInt(item.seconds_played);
  if (seconds != null) {
    return seconds;
  }

  const playtimeForever = readNonNegativeInt(item.playtime_forever);
  if (playtimeForever != null) {
    return playtimeForever * 60;
  }

  return 0;
};

const parseFamilyPlaytimeEntry = (
  item: unknown,
  steamId64: string
): { steamAppId: string; playtime: SteamFamilyPlaytime } | null => {
  if (!isRecord(item) || !belongsToConnectedAccount(item, steamId64)) {
    return null;
  }

  const steamAppId = readIdString(item.steamAppId) ?? readIdString(item.appid);
  if (!steamAppId || !STEAM_APP_ID_PATTERN.test(steamAppId)) {
    return null;
  }

  return {
    steamAppId,
    playtime: {
      playTimeInSeconds: readPlayTimeInSeconds(item),
      lastPlayedAt:
        unixSecondsToIso(item.latest_played) ??
        unixSecondsToIso(item.first_played),
    },
  };
};

const collectPlaytimeEntries = (payload: unknown): unknown[] => [
  ...extractNamedArray(payload, "entries", ["response", "entries"]),
  ...extractNamedArray(payload, "entries_by_owner", [
    "response",
    "entries_by_owner",
  ]),
];

const pickPreferredPlaytime = (
  current: SteamFamilyPlaytime | undefined,
  next: SteamFamilyPlaytime
): SteamFamilyPlaytime => {
  if (!current) return next;
  if (next.playTimeInSeconds > current.playTimeInSeconds) {
    return {
      playTimeInSeconds: next.playTimeInSeconds,
      lastPlayedAt: next.lastPlayedAt ?? current.lastPlayedAt,
    };
  }

  if (current.lastPlayedAt == null && next.lastPlayedAt != null) {
    return { ...current, lastPlayedAt: next.lastPlayedAt };
  }

  return current;
};

export const parseSteamFamilyPlaytimeByAppId = (
  payload: unknown,
  steamId64: string
): Map<string, SteamFamilyPlaytime> => {
  const playtimeByAppId = new Map<string, SteamFamilyPlaytime>();

  for (const item of collectPlaytimeEntries(payload)) {
    const parsed = parseFamilyPlaytimeEntry(item, steamId64);
    if (!parsed) continue;

    playtimeByAppId.set(
      parsed.steamAppId,
      pickPreferredPlaytime(
        playtimeByAppId.get(parsed.steamAppId),
        parsed.playtime
      )
    );
  }

  return playtimeByAppId;
};

export const parseSteamLastPlayedTimes = (
  payload: unknown
): Map<string, SteamFamilyPlaytime> => {
  const playtimeByAppId = new Map<string, SteamFamilyPlaytime>();

  for (const item of extractNamedArray(payload, "games", [
    "response",
    "games",
  ])) {
    if (!isRecord(item)) continue;

    const steamAppId =
      readIdString(item.steamAppId) ?? readIdString(item.appid);
    if (!steamAppId || !STEAM_APP_ID_PATTERN.test(steamAppId)) {
      continue;
    }

    playtimeByAppId.set(
      steamAppId,
      pickPreferredPlaytime(playtimeByAppId.get(steamAppId), {
        playTimeInSeconds:
          minutesToSeconds(item.playtime_forever) +
          minutesToSeconds(item.playtime_disconnected),
        lastPlayedAt:
          unixSecondsToIso(item.last_playtime) ??
          unixSecondsToIso(item.first_playtime),
      })
    );
  }

  return playtimeByAppId;
};

export const playtimeMapFromSharedApps = (
  familyApps: SteamFamilySharedApp[]
): Map<string, SteamFamilyPlaytime> => {
  const playtimeByAppId = new Map<string, SteamFamilyPlaytime>();

  for (const app of familyApps) {
    playtimeByAppId.set(
      app.steamAppId,
      pickPreferredPlaytime(playtimeByAppId.get(app.steamAppId), {
        playTimeInSeconds: app.playTimeInSeconds,
        lastPlayedAt: app.lastPlayedAt,
      })
    );
  }

  return playtimeByAppId;
};

export const mergeSteamFamilyPlaytimeMaps = (
  ...maps: Map<string, SteamFamilyPlaytime>[]
): Map<string, SteamFamilyPlaytime> => {
  const playtimeByAppId = new Map<string, SteamFamilyPlaytime>();

  for (const map of maps) {
    for (const [steamAppId, playtime] of map) {
      playtimeByAppId.set(
        steamAppId,
        pickPreferredPlaytime(playtimeByAppId.get(steamAppId), playtime)
      );
    }
  }

  return playtimeByAppId;
};

export const countSteamFamilyPlaytimeEntries = (
  playtimeByAppId: Map<string, SteamFamilyPlaytime>
) =>
  [...playtimeByAppId.values()].filter(
    (playtime) => playtime.playTimeInSeconds > 0
  ).length;

export const mergeSteamOwnedAndFamilyGames = (
  owned: SteamSourceLibraryGame[],
  familyApps: SteamFamilySharedApp[],
  playtimeByAppId: Map<string, SteamFamilyPlaytime>
): SteamSourceLibraryGame[] => {
  const seenAppIds = new Set<string>();
  const games: SteamSourceLibraryGame[] = [];

  for (const game of owned) {
    if (seenAppIds.has(game.steamAppId)) continue;
    seenAppIds.add(game.steamAppId);

    const extra = playtimeByAppId.get(game.steamAppId);
    if (!extra) {
      games.push(game);
      continue;
    }

    const merged = pickPreferredPlaytime(
      {
        playTimeInSeconds: game.playTimeInSeconds,
        lastPlayedAt: game.lastPlayedAt,
      },
      extra
    );

    games.push({
      ...game,
      playTimeInSeconds: merged.playTimeInSeconds,
      lastPlayedAt: merged.lastPlayedAt,
    });
  }

  for (const app of familyApps) {
    if (seenAppIds.has(app.steamAppId)) continue;
    seenAppIds.add(app.steamAppId);

    const playtime = pickPreferredPlaytime(
      {
        playTimeInSeconds: app.playTimeInSeconds,
        lastPlayedAt: app.lastPlayedAt,
      },
      playtimeByAppId.get(app.steamAppId) ?? {
        playTimeInSeconds: 0,
        lastPlayedAt: null,
      }
    );
    games.push({
      steamAppId: app.steamAppId,
      name: app.name,
      playTimeInSeconds: playtime.playTimeInSeconds,
      lastPlayedAt: playtime.lastPlayedAt,
    });
  }

  return games;
};
