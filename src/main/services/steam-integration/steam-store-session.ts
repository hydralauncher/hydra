import axios from "axios";
import https from "node:https";
import { BrowserWindow, session } from "electron";

import { steamSyncLogger } from "../logger";
import { WindowManager } from "../window-manager";
import { isSteamOpenIdSuccessUrl } from "./steam-openid-return";
import {
  parseSteamStoreSessionConfig,
  type SteamWebApiToken,
} from "./steam-store-session-config";
import { parseSteamTimezoneOffsetSeconds } from "./steam-community-achievements";

export { isSteamOpenIdSuccessUrl } from "./steam-openid-return";
export { STEAM_CONNECTED_DEEP_LINK } from "./steam-openid-return";
export { parseSteamStoreSessionConfig } from "./steam-store-session-config";
export type { SteamWebApiToken } from "./steam-store-session-config";

export const STEAM_SESSION_PARTITION = "persist:steam";
export const STEAM_STORE_EXPLORE_URL =
  "https://store.steampowered.com/explore/";

const STEAM_CHROME_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const communityHttpsAgent = new https.Agent({ family: 4 });

const requestUrl = (input: RequestInfo | URL) =>
  typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

export const createSteamCommunityCookieFetch = (
  cookieHeader: string
): typeof fetch => {
  const client = axios.create({
    httpsAgent: communityHttpsAgent,
    maxRedirects: 5,
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
    const body =
      typeof response.data === "string"
        ? response.data
        : response.data == null
          ? ""
          : JSON.stringify(response.data);
    const webResponse = new Response(body, { status: response.status });
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

export const closeSteamOpenIdWindow = () => {
  if (steamOpenIdWindow && !steamOpenIdWindow.isDestroyed()) {
    steamOpenIdWindow.close();
  }
};

const parentWindow = () =>
  WindowManager.mainWindow && !WindowManager.mainWindow.isDestroyed()
    ? WindowManager.mainWindow
    : null;

export const openSteamOpenIdWindow = (authorizationUrl: string) => {
  applySteamSessionUserAgent();
  closeSteamOpenIdWindow();

  const parent = parentWindow();
  const window = new BrowserWindow({
    width: 600,
    height: 720,
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
    notifySteamConnected();
    if (!window.isDestroyed()) {
      window.close();
    }
  };

  const interceptSteamConnected = (url: string) => {
    if (!isSteamOpenIdSuccessUrl(url)) return false;
    finishConnected(url);
    return true;
  };

  window.webContents.on("will-navigate", (event, url) => {
    if (interceptSteamConnected(url)) {
      event.preventDefault();
    }
  });

  window.webContents.on("will-redirect", (event, url) => {
    if (interceptSteamConnected(url)) {
      event.preventDefault();
    }
  });

  window.webContents.on("did-navigate", (_event, url) => {
    interceptSteamConnected(url);
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (interceptSteamConnected(url)) {
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
  hasLoginCookie: boolean;
  timeZoneOffsetSeconds: number;
};

export const readSteamCommunitySession =
  async (): Promise<SteamCommunitySession> => {
    applySteamSessionUserAgent();

    const steamSession = session.fromPartition(STEAM_SESSION_PARTITION);
    const [communityCookies, storeCookies] = await Promise.all([
      steamSession.cookies.get({ url: "https://steamcommunity.com/" }),
      steamSession.cookies.get({ url: "https://store.steampowered.com/" }),
    ]);
    const login = communityCookies.find(
      (cookie) => cookie.name === "steamLoginSecure" && cookie.value.length > 0
    );
    const timezone =
      communityCookies.find((cookie) => cookie.name === "timezoneOffset") ??
      storeCookies.find((cookie) => cookie.name === "timezoneOffset");
    const cookieHeader = communityCookies
      .filter((cookie) => cookie.value.length > 0)
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");

    return {
      fetch: createSteamCommunityCookieFetch(cookieHeader),
      hasLoginCookie: Boolean(login),
      timeZoneOffsetSeconds: parseSteamTimezoneOffsetSeconds(timezone?.value),
    };
  };

export const getSteamWebApiToken = async (
  signal?: AbortSignal
): Promise<SteamWebApiToken> => {
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

  signal?.addEventListener("abort", abort, { once: true });

  try {
    if (signal?.aborted) {
      const error = new Error("steam-sync-aborted");
      error.name = "AbortError";
      throw error;
    }

    await window.loadURL(STEAM_STORE_EXPLORE_URL);

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
  } finally {
    signal?.removeEventListener("abort", abort);
    if (!window.isDestroyed()) {
      window.destroy();
    }
  }
};
