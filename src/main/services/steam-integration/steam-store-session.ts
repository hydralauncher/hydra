import axios from "axios";
import https from "node:https";
import { type BrowserWindow, screen, session, WebContentsView } from "electron";

import {
  CUSTOM_WINDOW_BORDER_WIDTH,
  CUSTOM_WINDOW_TITLE_BAR_HEIGHT,
} from "@shared";

import { steamSyncLogger } from "../logger";
import { WindowManager } from "../window-manager";
import type { SteamConnectErrorCode } from "@types";
import {
  completeSteamOpenIdConnection,
  parseSteamOpenIdErrorBody,
  parseSteamOpenIdReturn,
} from "./steam-openid-return";
import { acquireSteamClientSession } from "./steam-client-session";
import type {
  SteamCommunityLogin,
  SteamWebApiToken,
} from "./steam-store-session-config";

export { isSteamOpenIdSuccessUrl } from "./steam-openid-return";
export { STEAM_CONNECTED_DEEP_LINK } from "./steam-openid-return";
export { parseSteamStoreSessionConfig } from "./steam-store-session-config";
export type { SteamWebApiToken } from "./steam-store-session-config";

export const STEAM_SESSION_PARTITION = "persist:steam";
export const STEAM_STORE_MAX_REDIRECTS = 5;

const STEAM_OPENID_VIEW_WIDTH = 600;
const STEAM_OPENID_VIEW_HEIGHT = 800;
const STEAM_OPENID_SCREEN_MARGIN = 80;

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

export const applySteamSessionUserAgent = () => {
  session
    .fromPartition(STEAM_SESSION_PARTITION)
    .setUserAgent(STEAM_CHROME_USER_AGENT);
};

export const closeSteamOpenIdWindow = () => {
  WindowManager.closeSteamConnectionWindow();
};

export const notifySteamConnected = () => {
  WindowManager.sendToAppWindows("on-steam-connected");
  WindowManager.redirect("settings?tab=integrations");
  closeSteamOpenIdWindow();
};

export const notifySteamConnectError = (code: SteamConnectErrorCode) => {
  WindowManager.sendToAppWindows("on-steam-connect-error", code);
  WindowManager.redirect("settings?tab=integrations");
  closeSteamOpenIdWindow();
};

const showSteamOpenIdView = (host: BrowserWindow, view: WebContentsView) => {
  const { workArea } = screen.getDisplayMatching(host.getBounds());
  const height = Math.min(
    STEAM_OPENID_VIEW_HEIGHT,
    workArea.height - STEAM_OPENID_SCREEN_MARGIN
  );
  const top =
    process.platform === "linux"
      ? CUSTOM_WINDOW_TITLE_BAR_HEIGHT + CUSTOM_WINDOW_BORDER_WIDTH
      : 0;

  host.setContentSize(STEAM_OPENID_VIEW_WIDTH, height + top);
  host.center();
  view.setBounds({
    x: 0,
    y: top,
    width: STEAM_OPENID_VIEW_WIDTH,
    height,
  });
  host.contentView.addChildView(view);
};

export const openSteamOpenIdWindow = (
  authorizationUrl: string,
  clearReconnectRequired: () => void
) => {
  const host = WindowManager.getSteamConnectionWindow();
  if (!host) return;

  applySteamSessionUserAgent();

  // The Steam page must never run with the Hydra preload, so it gets its own view.
  const view = new WebContentsView({
    webPreferences: {
      partition: STEAM_SESSION_PARTITION,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  const { webContents } = view;

  let finished = false;

  const finishConnected = (url: string) => {
    if (finished) return;
    finished = true;
    steamSyncLogger.log("Steam OpenID returned to Hydra", url);
    completeSteamOpenIdConnection({
      clearReconnectRequired,
      notifyConnected: notifySteamConnected,
    });
  };

  const finishError = (code: SteamConnectErrorCode, url: string) => {
    if (finished) return;
    finished = true;
    steamSyncLogger.error("Steam OpenID failed", code, url);
    notifySteamConnectError(code);
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

  webContents.on("will-navigate", (event, url) => {
    if (interceptSteamReturn(url)) {
      event.preventDefault();
    }
  });

  webContents.on("will-redirect", (event, url) => {
    if (interceptSteamReturn(url)) {
      event.preventDefault();
    }
  });

  webContents.on("did-navigate", (_event, url) => {
    interceptSteamReturn(url);
  });

  webContents.on("did-finish-load", () => {
    if (finished || webContents.isDestroyed()) return;

    void webContents
      .executeJavaScript('document.body?.innerText ?? ""')
      .then((text: unknown) => {
        if (finished || webContents.isDestroyed()) return;

        const result = parseSteamOpenIdErrorBody(
          typeof text === "string" ? text : ""
        );
        if (result?.kind === "error") {
          finishError(result.code, webContents.getURL());
        }
      })
      .catch((error) => {
        steamSyncLogger.error("Steam OpenID body parse failed", error);
      });
  });

  webContents.setWindowOpenHandler(({ url }) => {
    if (interceptSteamReturn(url)) {
      return { action: "deny" };
    }

    return { action: "allow" };
  });

  webContents.once("did-finish-load", () => {
    if (!finished && !host.isDestroyed()) {
      showSteamOpenIdView(host, view);
    }
  });

  host.once("closed", () => {
    if (!webContents.isDestroyed()) {
      webContents.close();
    }
  });

  void webContents.loadURL(authorizationUrl);
};

export type SteamCommunitySession = {
  fetch: typeof fetch;
  login: SteamCommunityLogin;
  timeZoneOffsetSeconds: number;
};

export const readSteamCommunitySession = async (
  signal?: AbortSignal
): Promise<SteamCommunitySession> => {
  const { steamId64, cookieHeader } = await acquireSteamClientSession(signal);

  return {
    fetch: createSteamCommunityCookieFetch(cookieHeader),
    login: { status: "logged-in", steamId64 },
    timeZoneOffsetSeconds: 0,
  };
};

export const getSteamWebApiToken = async (
  signal?: AbortSignal
): Promise<SteamWebApiToken> => {
  const { steamId64, accessToken } = await acquireSteamClientSession(signal);
  return { steamId64, accessToken };
};
