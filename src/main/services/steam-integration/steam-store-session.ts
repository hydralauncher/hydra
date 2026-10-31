import axios from "axios";
import https from "node:https";
import { BrowserWindow, session } from "electron";

import { steamSyncLogger } from "../logger";
import { WindowManager } from "../window-manager";
import type { SteamConnectErrorCode } from "@types";
import {
  completeSteamOpenIdConnection,
  parseSteamOpenIdErrorBody,
  parseSteamOpenIdReturn,
} from "./steam-openid-return";
import {
  parseSteamCommunityPageSteamId,
  parseSteamStoreSessionConfig,
  resolveSteamCommunityLogin,
  type SteamCommunityLogin,
  type SteamWebApiToken,
} from "./steam-store-session-config";
import { parseSteamTimezoneOffsetSeconds } from "./steam-community-achievements";
import { isSteamSyncAbortError } from "./steam-sync-errors";

export { isSteamOpenIdSuccessUrl } from "./steam-openid-return";
export { STEAM_CONNECTED_DEEP_LINK } from "./steam-openid-return";
export { parseSteamStoreSessionConfig } from "./steam-store-session-config";
export type { SteamWebApiToken } from "./steam-store-session-config";

export const STEAM_SESSION_PARTITION = "persist:steam";
export const STEAM_STORE_EXPLORE_URL =
  "https://store.steampowered.com/explore/";
export const STEAM_COMMUNITY_REFRESH_URL = "https://steamcommunity.com/my/";
export const STEAM_STORE_MAX_REDIRECTS = 5;

const STEAM_CHROME_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const communityHttpsAgent = new https.Agent({ family: 4 });

const requestUrl = (input: RequestInfo | URL) => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
};

const readAxiosResponseBody = (data: unknown): string => {
  if (typeof data === "string") return data;
  if (data == null) return "";
  return JSON.stringify(data);
};

const axiosHeaderValue = (
  headers: unknown,
  name: string
): string | undefined => {
  if (!headers || typeof headers !== "object") return undefined;

  const withGet = headers as { get?: (key: string) => unknown };
  if (typeof withGet.get === "function") {
    const fromGet = withGet.get(name);
    if (typeof fromGet === "string") return fromGet;
  }

  const record = headers as Record<string, unknown>;
  const value = record[name] ?? record[name.toLowerCase()];
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : undefined;
  }

  return typeof value === "string" ? value : undefined;
};

export const createSteamCommunityCookieFetch = (
  cookieHeader: string
): typeof fetch => {
  const client = axios.create({
    httpsAgent: communityHttpsAgent,
    maxRedirects: STEAM_STORE_MAX_REDIRECTS,
    responseType: "text",
    transitional: { clarifyTimeoutError: true },
    validateStatus: () => true,
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": STEAM_CHROME_USER_AGENT,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
  });

  return (async (input, init) => {
    const url = requestUrl(input);
    const response = await client.request({
      url,
      method: init?.method ?? "GET",
      signal: init?.signal,
    });
    const finalUrl =
      (response.request as { res?: { responseUrl?: string } } | undefined)?.res
        ?.responseUrl ?? url;
    const headers = new Headers();
    const retryAfter = axiosHeaderValue(response.headers, "retry-after");
    if (retryAfter) {
      headers.set("retry-after", retryAfter);
    }

    const webResponse = new Response(readAxiosResponseBody(response.data), {
      status: response.status,
      headers,
    });
    Object.defineProperty(webResponse, "url", { value: finalUrl });
    return webResponse;
  }) as typeof fetch;
};

let steamOpenIdWindow: BrowserWindow | null = null;

export const applySteamSessionUserAgent = () => {
  session
    .fromPartition(STEAM_SESSION_PARTITION)
    .setUserAgent(STEAM_CHROME_USER_AGENT);
};

export const notifySteamConnected = () => {
  WindowManager.sendToAppWindows("on-steam-connected");
  WindowManager.redirect("settings?tab=integrations");
};

export const notifySteamConnectError = (code: SteamConnectErrorCode) => {
  WindowManager.sendToAppWindows("on-steam-connect-error", code);
  WindowManager.redirect("settings?tab=integrations");
};

export const closeSteamOpenIdWindow = () => {
  if (steamOpenIdWindow && !steamOpenIdWindow.isDestroyed()) {
    steamOpenIdWindow.close();
  }
};

const parentWindow = () =>
  WindowManager.mainWindow && !WindowManager.mainWindow.isDestroyed()
    ? WindowManager.mainWindow
    : null;

export const openSteamOpenIdWindow = (
  authorizationUrl: string,
  clearReconnectRequired: () => void
) => {
  applySteamSessionUserAgent();
  closeSteamOpenIdWindow();

  const parent = parentWindow();
  const window = new BrowserWindow({
    width: 600,
    height: 800,
    parent: parent ?? undefined,
    modal: Boolean(parent),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      partition: STEAM_SESSION_PARTITION,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  steamOpenIdWindow = window;
  window.removeMenu();

  let finished = false;

  const finishConnected = (url: string) => {
    if (finished) return;
    finished = true;
    steamSyncLogger.log("Steam OpenID returned to Hydra", url);
    completeSteamOpenIdConnection({
      clearReconnectRequired,
      notifyConnected: notifySteamConnected,
    });
    if (!window.isDestroyed()) {
      window.close();
    }
  };

  const finishError = (code: SteamConnectErrorCode, url: string) => {
    if (finished) return;
    finished = true;
    steamSyncLogger.error("Steam OpenID failed", code, url);
    notifySteamConnectError(code);
    if (!window.isDestroyed()) {
      window.close();
    }
  };

  const interceptSteamReturn = (url: string) => {
    const result = parseSteamOpenIdReturn(url);
    if (!result) return false;

    if (result.kind === "success") {
      finishConnected(url);
      return true;
    }

    finishError(result.code, url);
    return true;
  };

  window.webContents.on("will-navigate", (event, url) => {
    if (interceptSteamReturn(url)) {
      event.preventDefault();
    }
  });

  window.webContents.on("will-redirect", (event, url) => {
    if (interceptSteamReturn(url)) {
      event.preventDefault();
    }
  });

  window.webContents.on("did-navigate", (_event, url) => {
    interceptSteamReturn(url);
  });

  window.webContents.on("did-finish-load", () => {
    if (finished || window.isDestroyed()) return;

    void window.webContents
      .executeJavaScript('document.body?.innerText ?? ""')
      .then((text: unknown) => {
        if (finished || window.isDestroyed()) return;

        const result = parseSteamOpenIdErrorBody(
          typeof text === "string" ? text : ""
        );
        if (result?.kind === "error") {
          finishError(result.code, window.webContents.getURL());
        }
      })
      .catch((error) => {
        steamSyncLogger.error("Steam OpenID body parse failed", error);
      });
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (interceptSteamReturn(url)) {
      return { action: "deny" };
    }

    return { action: "allow" };
  });

  window.once("closed", () => {
    if (steamOpenIdWindow === window) {
      steamOpenIdWindow = null;
    }
  });

  void window.loadURL(authorizationUrl);
  window.once("ready-to-show", () => {
    if (!window.isDestroyed()) {
      window.show();
    }
  });
};

export type SteamCommunitySession = {
  fetch: typeof fetch;
  login: SteamCommunityLogin;
  timeZoneOffsetSeconds: number;
};

const loadHiddenSteamPage = async <T>(
  url: string,
  signal: AbortSignal | undefined,
  read: (window: BrowserWindow) => Promise<T>
): Promise<T> => {
  applySteamSessionUserAgent();

  const window = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: {
      partition: STEAM_SESSION_PARTITION,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const abort = () => {
    if (!window.isDestroyed()) {
      window.destroy();
    }
  };

  const abortError = () => {
    const error = new Error("steam-sync-aborted");
    error.name = "AbortError";
    return error;
  };

  signal?.addEventListener("abort", abort, { once: true });

  try {
    if (signal?.aborted) {
      throw abortError();
    }

    await window.loadURL(url);
    return await read(window);
  } catch (error) {
    // Destroying the window on abort rejects the load with ERR_ABORTED.
    if (signal?.aborted) {
      throw abortError();
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    if (!window.isDestroyed()) {
      window.destroy();
    }
  }
};

/**
 * Steam Community access tokens (steamLoginSecure) expire after about a day.
 * Loading a Community page in the Steam partition lets Steam renew it through
 * login.steampowered.com/jwt/refresh before the cookies are copied into the
 * non-browser fetch used for scraping.
 */
const refreshSteamCommunityLogin = (signal?: AbortSignal) =>
  loadHiddenSteamPage(STEAM_COMMUNITY_REFRESH_URL, signal, async (window) => {
    const currentUrl = window.webContents.getURL();
    const steamIdRaw: unknown = await window.webContents.executeJavaScript(
      'typeof g_steamID === "undefined" ? null : g_steamID'
    );

    const steamId64 = parseSteamCommunityPageSteamId({
      currentUrl,
      steamIdRaw,
    });
    if (!steamId64) {
      steamSyncLogger.log("Steam Community session is logged out", currentUrl);
    }

    return steamId64;
  });

export const readSteamCommunitySession = async (
  signal?: AbortSignal
): Promise<SteamCommunitySession> => {
  let refreshed: { steamId64: string | null } | null = null;
  try {
    refreshed = { steamId64: await refreshSteamCommunityLogin(signal) };
  } catch (error) {
    if (isSteamSyncAbortError(error)) throw error;
    steamSyncLogger.error(
      "Steam Community refresh failed, using stored cookies",
      error
    );
  }

  const steamSession = session.fromPartition(STEAM_SESSION_PARTITION);
  const [communityCookies, storeCookies] = await Promise.all([
    steamSession.cookies.get({ url: "https://steamcommunity.com/" }),
    steamSession.cookies.get({ url: "https://store.steampowered.com/" }),
  ]);
  const hasLoginCookie = communityCookies.some(
    (cookie) => cookie.name === "steamLoginSecure" && cookie.value.length > 0
  );
  const login = resolveSteamCommunityLogin({ refreshed, hasLoginCookie });
  const timezone =
    communityCookies.find((cookie) => cookie.name === "timezoneOffset") ??
    storeCookies.find((cookie) => cookie.name === "timezoneOffset");
  const cookieHeader = communityCookies
    .filter((cookie) => cookie.value.length > 0)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");

  return {
    fetch: createSteamCommunityCookieFetch(cookieHeader),
    login,
    timeZoneOffsetSeconds: parseSteamTimezoneOffsetSeconds(timezone?.value),
  };
};

export const getSteamWebApiToken = (
  signal?: AbortSignal
): Promise<SteamWebApiToken> =>
  loadHiddenSteamPage(STEAM_STORE_EXPLORE_URL, signal, async (window) => {
    const currentUrl = window.webContents.getURL();
    const config = (await window.webContents.executeJavaScript(`
      (() => {
        const el = document.getElementById("application_config");
        if (!el) {
          return { userInfoRaw: null, storeConfigRaw: null };
        }
        return {
          userInfoRaw: el.getAttribute("data-userinfo"),
          storeConfigRaw: el.getAttribute("data-store_user_config"),
        };
      })()
    `)) as { userInfoRaw: string | null; storeConfigRaw: string | null };

    return parseSteamStoreSessionConfig({
      ...config,
      currentUrl,
    });
  });
