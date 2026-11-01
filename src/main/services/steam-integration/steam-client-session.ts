import { createRequire } from "node:module";
import { randomInt } from "node:crypto";
import { safeStorage, session } from "electron";

import { db, levelKeys } from "@main/level";

import { steamSyncLogger } from "../logger";
import {
  mapSteamClientAchievements,
  type SteamClientAchievementBlock,
  type SteamClientPlayerAchievement,
} from "./steam-client-achievements";
import { SteamClientUnavailableError } from "./steam-sync-errors";
import { SteamSessionRequiredError } from "./steam-store-session-config";

const require = createRequire(import.meta.url);

type SteamUserClient = {
  steamID: { getSteamID64: () => string } | null;
  logOn: (details: { refreshToken: string; logonID: number }) => void;
  logOff: () => void;
  on: (event: string, listener: (...args: never[]) => void) => void;
  once: (event: string, listener: (...args: never[]) => void) => void;
  removeListener: (event: string, listener: (...args: never[]) => void) => void;
  getPlayerCount: (appId: number) => Promise<unknown>;
  // steam-user has no public API for user stats, so the message goes through its internals.
  _send: (header: { msg: number; proto: object }, body: Buffer) => void;
};

type SteamClientUserStatsResponse = {
  game_id: { toString: () => string };
  eresult?: number;
  schema?: Uint8Array | null;
  achievement_blocks?: SteamClientAchievementBlock[] | null;
};

const SteamUser = require("steam-user") as {
  new (options: object): SteamUserClient;
  prototype: {
    _handlerManager: {
      add: (
        msg: number,
        handler: (this: SteamUserClient, body: Buffer) => void
      ) => void;
    };
  };
};
const BinaryKV = require("binarykvparser") as {
  parse: (buffer: Buffer) => unknown;
};
const Schema = require("steam-user/protobufs/generated/_load.js") as Record<
  string,
  unknown
>;
const EMsg = require("steam-user/enums/EMsg.js") as Record<string, number>;
const Messages = require("steam-user/components/03-messages.js") as {
  _encodeProto: (proto: unknown, data: object) => Buffer;
  _decodeProto: (proto: unknown, data: Buffer) => SteamClientUserStatsResponse;
};

const STEAM_SESSION_PARTITION = "persist:steam";
const STEAM_COOKIE_URLS = [
  "https://steamcommunity.com/",
  "https://store.steampowered.com/",
];
const CONNECT_TIMEOUT_MS = 30_000;
const USER_STATS_TIMEOUT_MS = 15_000;
const IDLE_DISCONNECT_MS = 60_000;
const MAX_LOGON_ID = 0x7fffffff;
const STEAM_APP_ID_MASK = 0xffffffn;
const STEAM_RESULT_OK = 1;
const MAX_CONNECT_ATTEMPTS = 3;
const MAX_STATS_ATTEMPTS = 3;
const RESPONSE_CHECK_APP_ID = 480;
const CLIENT_DEBUG_LINES_KEPT = 30;

const STEAM_AUTH_FAILURE_RESULTS = new Set([
  5, // InvalidPassword
  15, // AccessDenied
  26, // Revoked
  27, // Expired
]);

export type SteamClientSession = {
  steamId64: string;
  accessToken: string;
  cookieHeader: string;
};

export type SteamClientAchievementsResult =
  | { kind: "ok"; achievements: SteamClientPlayerAchievement[] }
  | { kind: "unavailable"; reason: string };

type ActiveConnection = SteamClientSession & {
  client: SteamUserClient;
  pendingStats: Map<
    number,
    (response: SteamClientUserStatsResponse | null) => void
  >;
  debugLines: string[];
  lastStatsResponseAt: number;
};

let memoryRefreshToken: string | null = null;
let activeConnection: ActiveConnection | null = null;
let connecting: Promise<ActiveConnection> | null = null;
let idleTimer: NodeJS.Timeout | null = null;

// steam-user shares handlers across all clients and drops repeated ones, so this
// is registered once and finds the connection from the client that received it.
SteamUser.prototype._handlerManager.add(
  EMsg.ClientGetUserStatsResponse,
  function (this: SteamUserClient, body: Buffer) {
    if (activeConnection?.client !== this) return;

    const response = Messages._decodeProto(
      Schema.CMsgClientGetUserStatsResponse,
      body
    );
    const appId = Number(
      BigInt(response.game_id.toString()) & STEAM_APP_ID_MASK
    );
    activeConnection.lastStatsResponseAt = Date.now();
    activeConnection.pendingStats.get(appId)?.(response);
  }
);

const readStoredRefreshToken = async () => {
  if (memoryRefreshToken) return memoryRefreshToken;

  const stored = await db
    .get<string, string>(levelKeys.steamClientRefreshToken, {
      valueEncoding: "utf8",
    })
    .catch(() => null);
  if (!stored || !safeStorage.isEncryptionAvailable()) return null;

  try {
    memoryRefreshToken = safeStorage.decryptString(
      Buffer.from(stored, "base64")
    );
    return memoryRefreshToken;
  } catch (error) {
    steamSyncLogger.error("Could not read the stored Steam login", error);
    return null;
  }
};

export const saveSteamClientRefreshToken = async (refreshToken: string) => {
  memoryRefreshToken = refreshToken;

  if (!safeStorage.isEncryptionAvailable()) {
    steamSyncLogger.log("Steam login kept in memory: no secure storage");
    return;
  }

  await db.put(
    levelKeys.steamClientRefreshToken,
    safeStorage.encryptString(refreshToken).toString("base64"),
    { valueEncoding: "utf8" }
  );
};

const logOffClient = (client: SteamUserClient) => {
  try {
    client.logOff();
  } catch (error) {
    steamSyncLogger.error("Steam client log off failed", error);
  }
};

const closeActiveConnection = () => {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  const connection = activeConnection;
  activeConnection = null;
  if (!connection) return;

  for (const resolve of connection.pendingStats.values()) {
    resolve(null);
  }
  connection.pendingStats.clear();

  logOffClient(connection.client);
};

const keepConnectionAlive = () => {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(closeActiveConnection, IDLE_DISCONNECT_MS);
};

const clearSteamSessionStorage = () =>
  session.fromPartition(STEAM_SESSION_PARTITION).clearStorageData();

export const clearSteamClientSession = async () => {
  closeActiveConnection();
  memoryRefreshToken = null;

  await db.del(levelKeys.steamClientRefreshToken).catch(() => undefined);
  await clearSteamSessionStorage();
};

export const prepareSteamClientLogin = async () => {
  closeActiveConnection();
  await clearSteamSessionStorage();
};

const applyCookiesToSteamSession = async (cookies: string[]) => {
  const steamSession = session.fromPartition(STEAM_SESSION_PARTITION);

  await Promise.all(
    STEAM_COOKIE_URLS.flatMap((url) =>
      [...cookies, "timezoneOffset=0,0"].map((cookie) => {
        const pair = cookie.split(";")[0];
        const separator = pair.indexOf("=");
        return steamSession.cookies.set({
          url,
          name: pair.slice(0, separator),
          value: pair.slice(separator + 1),
          secure: true,
          sameSite: "no_restriction",
        });
      })
    )
  );
};

const cookieHeaderFrom = (cookies: string[]) =>
  [...cookies.map((cookie) => cookie.split(";")[0]), "timezoneOffset=0,0"].join(
    "; "
  );

const accessTokenFrom = (cookies: string[]) => {
  const secure = cookies.find((cookie) =>
    cookie.startsWith("steamLoginSecure=")
  );
  const value = secure?.split(";")[0].slice("steamLoginSecure=".length);
  return value ? (decodeURIComponent(value).split("||")[1] ?? null) : null;
};

const logOnWithRefreshToken = (refreshToken: string) =>
  new Promise<ActiveConnection>((resolve, reject) => {
    const client = new SteamUser({
      dataDirectory: null,
      autoRelogin: false,
      renewRefreshTokens: true,
    });
    const debugLines: string[] = [];
    const connection: ActiveConnection = {
      client,
      pendingStats: new Map(),
      debugLines,
      lastStatsResponseAt: 0,
      steamId64: "",
      accessToken: "",
      cookieHeader: "",
    };

    client.on("debug", (line: never) => {
      debugLines.push(String(line));
      if (debugLines.length > CLIENT_DEBUG_LINES_KEPT) debugLines.shift();
    });

    const timer = setTimeout(() => {
      reject(new Error("steam-client-connect-timeout"));
      client.logOff();
    }, CONNECT_TIMEOUT_MS);

    client.on("refreshToken", (newToken: never) => {
      void saveSteamClientRefreshToken(newToken);
    });

    client.on("error", (error: never) => {
      clearTimeout(timer);
      const { eresult, message } = error as {
        eresult?: number;
        message?: string;
      };
      steamSyncLogger.error("Steam client error", eresult ?? message);
      if (activeConnection?.client === client) {
        activeConnection = null;
      }
      reject(
        eresult != null && STEAM_AUTH_FAILURE_RESULTS.has(eresult)
          ? new SteamSessionRequiredError()
          : new Error(`steam-client-error-${eresult ?? "unknown"}`)
      );
    });

    client.on("disconnected", (eresult: never, message: never) => {
      steamSyncLogger.log("Steam client disconnected", eresult, message);
      if (activeConnection?.client === client) {
        activeConnection = null;
      }
    });

    client.once("webSession", (_sessionId: never, cookies: never) => {
      clearTimeout(timer);
      const webCookies = cookies as string[];
      const steamId64 = client.steamID?.getSteamID64();
      const accessToken = accessTokenFrom(webCookies);

      if (!steamId64 || !accessToken) {
        reject(new SteamSessionRequiredError());
        return;
      }

      void applyCookiesToSteamSession(webCookies).then(
        () =>
          resolve(
            Object.assign(connection, {
              steamId64,
              accessToken,
              cookieHeader: cookieHeaderFrom(webCookies),
            })
          ),
        reject
      );
    });

    client.logOn({ refreshToken, logonID: randomInt(1, MAX_LOGON_ID) });
  });

// Cookies come over HTTP, so a logged-on client can still be deaf on the Steam connection.
const clientAnswers = async ({ client }: Pick<ActiveConnection, "client">) => {
  try {
    await client.getPlayerCount(RESPONSE_CHECK_APP_ID);
    return true;
  } catch (error) {
    return (error as { eresult?: number } | null)?.eresult != null;
  }
};

const logDeafConnection = ({ debugLines }: ActiveConnection) => {
  steamSyncLogger.error("Steam client connection is not answering", {
    recentActivity: debugLines,
  });
};

const openAnsweringConnection = async (refreshToken: string) => {
  for (let attempt = 1; attempt <= MAX_CONNECT_ATTEMPTS; attempt += 1) {
    try {
      const connection = await logOnWithRefreshToken(refreshToken);
      if (await clientAnswers(connection)) return connection;

      logDeafConnection(connection);
      logOffClient(connection.client);
    } catch (error) {
      if (error instanceof SteamSessionRequiredError) throw error;
      steamSyncLogger.error(
        `Steam client connection attempt ${attempt} failed`,
        error
      );
    }
  }

  throw new SteamClientUnavailableError();
};

const getConnection = async (signal?: AbortSignal) => {
  if (signal?.aborted) {
    const error = new Error("steam-sync-aborted");
    error.name = "AbortError";
    throw error;
  }

  if (activeConnection) {
    keepConnectionAlive();
    return activeConnection;
  }

  connecting ??= (async () => {
    const refreshToken = await readStoredRefreshToken();
    if (!refreshToken) throw new SteamSessionRequiredError();

    try {
      activeConnection = await openAnsweringConnection(refreshToken);
      steamSyncLogger.log("Steam client connected");
      keepConnectionAlive();
      return activeConnection;
    } catch (error) {
      if (error instanceof SteamSessionRequiredError) {
        await clearSteamClientSession();
      }
      throw error;
    }
  })().finally(() => {
    connecting = null;
  });

  return connecting;
};

export const acquireSteamClientSession = async (
  signal?: AbortSignal
): Promise<SteamClientSession> => {
  const { steamId64, accessToken, cookieHeader } = await getConnection(signal);
  return { steamId64, accessToken, cookieHeader };
};

const requestUserStats = (
  connection: ActiveConnection,
  steamAppId: string,
  signal?: AbortSignal
) => {
  const appId = Number(steamAppId);

  return new Promise<SteamClientUserStatsResponse | null>((resolve) => {
    const finish = (value: SteamClientUserStatsResponse | null) => {
      clearTimeout(timer);
      connection.pendingStats.delete(appId);
      signal?.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), USER_STATS_TIMEOUT_MS);

    signal?.addEventListener("abort", onAbort, { once: true });
    connection.pendingStats.set(appId, finish);
    connection.client._send(
      { msg: EMsg.ClientGetUserStats, proto: {} },
      Messages._encodeProto(Schema.CMsgClientGetUserStats, {
        game_id: steamAppId,
        crc_stats: 0,
        schema_local_version: -1,
        steam_id_for_user: connection.steamId64,
      })
    );
  });
};

const requestUserStatsWithReconnect = async (
  steamAppId: string,
  signal?: AbortSignal
) => {
  for (let attempt = 1; attempt <= MAX_STATS_ATTEMPTS; attempt += 1) {
    const connection = await getConnection(signal);
    const requestedAt = Date.now();
    const response = await requestUserStats(connection, steamAppId, signal);
    if (response || signal?.aborted) return response;

    // Other games answering means only this one is slow; otherwise the connection went deaf.
    if (
      activeConnection === connection &&
      connection.lastStatsResponseAt < requestedAt
    ) {
      logDeafConnection(connection);
      closeActiveConnection();
    }
  }

  return null;
};

export const fetchSteamClientAchievements = async (
  steamAppId: string,
  signal?: AbortSignal
): Promise<SteamClientAchievementsResult> => {
  const response = await requestUserStatsWithReconnect(steamAppId, signal);

  keepConnectionAlive();

  if (
    !response ||
    response.eresult !== STEAM_RESULT_OK ||
    !response.schema?.length
  ) {
    return {
      kind: "unavailable",
      reason: response
        ? `eresult=${response.eresult} schemaBytes=${response.schema?.length ?? 0}`
        : "no-response",
    };
  }

  try {
    const achievements = mapSteamClientAchievements(
      BinaryKV.parse(Buffer.from(response.schema)),
      response.achievement_blocks ?? []
    );
    return achievements.length > 0
      ? { kind: "ok", achievements }
      : {
          kind: "unavailable",
          reason: `no-achievements-in-schema schemaBytes=${response.schema.length}`,
        };
  } catch (error) {
    steamSyncLogger.error(
      `Steam client stats could not be parsed for ${steamAppId}`,
      error
    );
    return { kind: "unavailable", reason: "parse-error" };
  }
};
