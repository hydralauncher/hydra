import axios, { AxiosError, AxiosInstance } from "axios";
import { WindowManager } from "./window-manager";
import url from "url";
import { uploadGamesBatch } from "./library-sync";
import { clearGamesRemoteIds } from "./library-sync/clear-games-remote-id";
import { networkLogger as logger } from "./logger";
import { UserNotLoggedInError } from "@shared";
import { omit } from "lodash-es";
import { appVersion } from "@main/constants";
import { getUserData } from "./user/get-user-data";
import { db } from "@main/level";
import { levelKeys } from "@main/level/sublevels";
import type { Auth, User } from "@types";
import { SSEClient } from "./sse";
import { getStoredProfileAssetUrls } from "./drive/drive-storage";
import { createHybridAdapter } from "./hydra-hybrid-adapter";

// Hybrid mode: this build never enforces the Hydra Cloud paywall. Every
// paid feature is either satisfied locally (avatar/banner served from Drive)
// or intercepted before it reaches Hydra's server (cloud saves go to Drive
// instead). The interceptor below rewrites /profile/me responses so the
// renderer's Redux slice sees an evergreen subscription, and hasActiveSubscription()
// hard-returns true so main-process gates never throw SubscriptionRequiredError.
const HYBRID_SUBSCRIPTION_PAYLOAD = {
  id: "hybrid-drive",
  status: "active" as const,
  plan: { id: "hybrid", name: "Google Drive (Hybrid)" },
  expiresAt: "9999-12-31T23:59:59.000Z",
  paymentMethod: "pix" as const,
};

export interface HydraApiOptions {
  needsAuth?: boolean;
  needsSubscription?: boolean;
  ifModifiedSince?: Date;
  ifNoneMatch?: string;
  validateStatus?: (status: number) => boolean;
  signal?: AbortSignal;
}

interface HydraApiUserAuth {
  authToken: string;
  refreshToken: string;
  expirationTimestamp: number;
  subscription: { expiresAt: Date | string | null } | null;
}

export class HydraApi {
  private static instance: AxiosInstance;

  private static readonly EXPIRATION_OFFSET_IN_MS = 1000 * 60 * 5; // 5 minutes
  private static readonly ADD_LOG_INTERCEPTOR = true;

  private static secondsToMilliseconds(seconds: number) {
    return seconds * 1000;
  }

  private static userAuth: HydraApiUserAuth = {
    authToken: "",
    refreshToken: "",
    expirationTimestamp: 0,
    subscription: null,
  };

  // Cached id of the signed-in user. Populated the first time we see a
  // /profile/me or /profile PATCH response. Used by the response interceptor
  // to decide whether a /users/:userId response is for the current user
  // (so we should inject our Drive-hosted avatar/banner) or someone else
  // (leave the response alone).
  private static currentUserId: string | null = null;

  public static isLoggedIn() {
    return this.userAuth.authToken !== "";
  }

  public static hasActiveSubscription() {
    // Hybrid: paywalled features are unlocked locally. Every caller that used
    // to gate on this flag (cloud-sync.ts, game-artwork-cloud.ts, etc.) is
    // either intercepted to hit Google Drive or already rewritten to skip the
    // Hydra endpoint entirely, so it's always safe to return true here.
    return true;
  }

  public static async applyHybridProfileOverrides<T>(payload: T): Promise<T> {
    if (!payload || typeof payload !== "object") return payload;
    const stored = await getStoredProfileAssetUrls().catch(() => ({
      profileImageUrl: null,
      backgroundImageUrl: null,
    }));
    const overrides: Record<string, unknown> = {
      subscription: HYBRID_SUBSCRIPTION_PAYLOAD,
      hasActiveSubscription: true,
      quirks: {
        ...((payload as any).quirks ?? {}),
        backupsPerGameLimit: 0,
      },
    };
    if (stored.profileImageUrl) overrides.profileImageUrl = stored.profileImageUrl;
    if (stored.backgroundImageUrl) overrides.backgroundImageUrl = stored.backgroundImageUrl;
    return { ...(payload as object), ...overrides } as T;
  }

  static async handleExternalAuth(uri: string) {
    const { payload } = url.parse(uri, true).query;

    const decodedBase64 = atob(payload as string);
    const jsonData = JSON.parse(decodedBase64);

    const { accessToken, expiresIn, refreshToken, workwondersJwt } = jsonData;

    const now = new Date();

    const tokenExpirationTimestamp =
      now.getTime() +
      this.secondsToMilliseconds(expiresIn) -
      this.EXPIRATION_OFFSET_IN_MS;

    this.userAuth = {
      authToken: accessToken,
      refreshToken: refreshToken,
      expirationTimestamp: tokenExpirationTimestamp,
      subscription: null,
    };

    const { AchievementWatcherManager } = await import(
      "./achievements/achievement-watcher-manager"
    );
    AchievementWatcherManager.resetSessionState();

    logger.log(
      "Sign in received. Token expiration timestamp:",
      tokenExpirationTimestamp
    );

    db.put<string, Auth>(
      levelKeys.auth,
      {
        accessToken,
        refreshToken,
        tokenExpirationTimestamp,
        workwondersJwt,
      },
      { valueEncoding: "json" }
    );

    await getUserData().then((userDetails) => {
      if (userDetails?.subscription) {
        this.userAuth.subscription = {
          expiresAt: userDetails.subscription.expiresAt
            ? new Date(userDetails.subscription.expiresAt)
            : null,
        };
      }
    });

    if (WindowManager.mainWindow) {
      WindowManager.mainWindow.webContents.send("on-signin");
      await clearGamesRemoteIds();
      void uploadGamesBatch();

      SSEClient.close();
      SSEClient.connect();

      const { syncDownloadSourcesFromApi } = await import("./user");
      syncDownloadSourcesFromApi();
    }
  }

  static async handleSignOut() {
    this.userAuth = {
      authToken: "",
      refreshToken: "",
      expirationTimestamp: 0,
      subscription: null,
    };
    this.currentUserId = null;

    const { AchievementWatcherManager } = await import(
      "./achievements/achievement-watcher-manager"
    );
    AchievementWatcherManager.resetSessionState();

    this.sendSignOutEvent();
    this.post("/auth/logout", {}, { needsAuth: false }).catch(() => {});
  }

  static async setupApi() {
    const base = axios.create({
      baseURL: import.meta.env.MAIN_VITE_API_URL,
      headers: { "User-Agent": `Hydra Launcher v${appVersion}` },
    });
    // Wrap the default adapter with the hybrid one so specific URLs get
    // served from Drive + local Level DB before ever leaving the process.
    base.defaults.adapter = createHybridAdapter(base.defaults.adapter as any);
    this.instance = base;

    if (this.ADD_LOG_INTERCEPTOR) {
      this.instance.interceptors.request.use(
        (request) => {
          logger.log(" ---- REQUEST -----");
          const data = Array.isArray(request.data)
            ? request.data
            : omit(request.data, ["token", "accessToken", "refreshToken"]);
          logger.log(request.method, request.url, request.params, data);
          return request;
        },
        (error) => {
          logger.error("request error", error);
          return Promise.reject(error);
        }
      );
      this.instance.interceptors.response.use(
        async (response) => {
          logger.log(" ---- RESPONSE -----");
          const data = Array.isArray(response.data)
            ? response.data
            : omit(response.data, [
                "username",
                "token",
                "accessToken",
                "refreshToken",
              ]);
          logger.log(
            response.status,
            response.config.method,
            response.config.url,
            data
          );
          // Hybrid rewrite: any Hydra `/profile/me` response (or the
          // `/profile` PATCH echo, which has the same shape) gets a permanent
          // active subscription grafted on, and locally-stored Drive URLs for
          // avatar/banner override whatever Hydra returned. This is what
          // unlocks the entire Redux paywall UI without patching individual
          // gates in the renderer. We also apply the same overrides to
          // `/users/:userId` responses when the id matches the signed-in
          // user, so their own profile page shows the Drive avatar too.
          const requestPath = (response.config?.url ?? "").split("?")[0];
          const isSelfProfile =
            requestPath.endsWith("/profile/me") || requestPath.endsWith("/profile");
          const userMatch = /^\/users\/([^/]+)$/.exec(requestPath);
          const responseId =
            response.data && typeof response.data === "object"
              ? (response.data as { id?: string }).id
              : undefined;
          const isOwnUserPage = Boolean(
            userMatch && responseId && HydraApi.currentUserId === responseId
          );

          if (
            response.status === 200 &&
            response.data &&
            typeof response.data === "object" &&
            (isSelfProfile || isOwnUserPage)
          ) {
            if (isSelfProfile && typeof responseId === "string") {
              HydraApi.currentUserId = responseId;
            }
            response.data = await HydraApi.applyHybridProfileOverrides(response.data);
            // Temporary debug: show what my hybrid override actually put on
            // the response. Look for "[hybrid override]" lines in the log.
            logger.log(
              "[hybrid override]",
              requestPath,
              "profileImageUrl=",
              (response.data as { profileImageUrl?: string | null })
                ?.profileImageUrl,
              "backgroundImageUrl=",
              (response.data as { backgroundImageUrl?: string | null })
                ?.backgroundImageUrl,
              "currentUserId=",
              HydraApi.currentUserId
            );
          } else if (userMatch) {
            logger.log(
              "[hybrid override] SKIPPED",
              requestPath,
              "responseId=",
              responseId,
              "currentUserId=",
              HydraApi.currentUserId
            );
          }
          return response;
        },
        (error) => {
          logger.error(" ---- RESPONSE ERROR -----");
          const { config } = error;

          const data = JSON.parse(config.data ?? null);

          logger.error(
            config.method,
            config.baseURL,
            config.url,
            omit(config.headers, [
              "accessToken",
              "refreshToken",
              "Authorization",
            ]),
            Array.isArray(data)
              ? data
              : omit(data, ["accessToken", "refreshToken"])
          );
          if (error.response) {
            logger.error(
              "Response error:",
              error.response.status,
              error.response.data
            );

            return Promise.reject(error as Error);
          }

          if (error.request) {
            const errorData = error.toJSON();
            logger.error("Request error:", errorData.code, errorData.message);
            return Promise.reject(
              new Error(
                `Request failed with ${errorData.code} ${errorData.message}`
              )
            );
          }

          logger.error("Error", error.message);
          return Promise.reject(error as Error);
        }
      );
    }

    const result = await db.getMany<string>([levelKeys.auth, levelKeys.user], {
      valueEncoding: "json",
    });

    const userAuth = result.at(0) as Auth | undefined;
    const user = result.at(1) as User | undefined;

    // Seed currentUserId eagerly from the User cached in Level DB so the
    // /users/:userId interceptor can identify "our own profile" even when
    // that response happens to arrive before the /profile/me response does
    // (they fire in parallel on boot and either can win the race).
    if (user?.id) {
      HydraApi.currentUserId = user.id;
    }

    this.userAuth = {
      authToken: userAuth?.accessToken ?? "",
      refreshToken: userAuth?.refreshToken ?? "",
      expirationTimestamp: userAuth?.tokenExpirationTimestamp ?? 0,
      subscription: user?.subscription
        ? { expiresAt: user.subscription?.expiresAt }
        : null,
    };

    const updatedUserData = await getUserData();

    this.userAuth.subscription = updatedUserData?.subscription
      ? {
          expiresAt: updatedUserData.subscription.expiresAt,
        }
      : null;
  }

  private static sendSignOutEvent() {
    WindowManager.sendToAppWindows("on-signout");
  }

  public static async refreshToken() {
    const response = await this.instance.post(`/auth/refresh`, {
      refreshToken: this.userAuth.refreshToken,
    });

    const { accessToken, expiresIn } = response.data;

    const tokenExpirationTimestamp =
      Date.now() +
      this.secondsToMilliseconds(expiresIn) -
      this.EXPIRATION_OFFSET_IN_MS;

    this.userAuth.authToken = accessToken;
    this.userAuth.expirationTimestamp = tokenExpirationTimestamp;

    logger.log(
      "Token refreshed. New expiration:",
      this.userAuth.expirationTimestamp
    );

    await db
      .get<string, Auth>(levelKeys.auth, { valueEncoding: "json" })
      .then((auth) => {
        return db.put<string, Auth>(
          levelKeys.auth,
          {
            ...auth,
            accessToken,
            tokenExpirationTimestamp,
          },
          { valueEncoding: "json" }
        );
      });

    return { accessToken, expiresIn };
  }

  private static async revalidateAccessTokenIfExpired() {
    if (this.userAuth.expirationTimestamp < Date.now()) {
      try {
        await this.refreshToken();
      } catch (err) {
        await this.handleUnauthorizedError(err);
      }
    }
  }

  private static getAxiosConfig() {
    return {
      headers: {
        Authorization: `Bearer ${this.userAuth.authToken}`,
      },
    };
  }

  private static readonly handleUnauthorizedError = async (err) => {
    if (err instanceof AxiosError && err.response?.status === 401) {
      logger.error(
        "401 - Current credentials:",
        this.userAuth,
        err.response?.data
      );

      this.userAuth = {
        authToken: "",
        expirationTimestamp: 0,
        refreshToken: "",
        subscription: null,
      };

      const { AchievementWatcherManager } = await import(
        "./achievements/achievement-watcher-manager"
      );
      AchievementWatcherManager.resetSessionState();

      db.batch([
        {
          type: "del",
          key: levelKeys.auth,
        },
        {
          type: "del",
          key: levelKeys.user,
        },
      ]);

      SSEClient.close();
      this.sendSignOutEvent();
    }

    throw err;
  };

  private static async validateOptions(options?: HydraApiOptions) {
    const needsAuth = options?.needsAuth == undefined || options.needsAuth;
    // Hybrid: needsSubscription is a no-op — hasActiveSubscription() is
    // always true so any caller passing that flag would have proceeded
    // anyway. The check is dropped here to avoid an import cycle around
    // SubscriptionRequiredError, which no longer has a live throw site.
    if (needsAuth) {
      if (!this.isLoggedIn()) throw new UserNotLoggedInError();
      await this.revalidateAccessTokenIfExpired();
    }
  }

  static async get<T = any>(
    url: string,
    params?: any,
    options?: HydraApiOptions
  ) {
    await this.validateOptions(options);

    const headers = {
      ...this.getAxiosConfig().headers,
      "Hydra-If-Modified-Since": options?.ifModifiedSince?.toUTCString(),
      "If-None-Match": options?.ifNoneMatch,
    };

    return this.instance
      .get<T>(url, {
        params,
        ...this.getAxiosConfig(),
        headers,
        validateStatus: options?.validateStatus,
        signal: options?.signal,
      })
      .then((response) => response.data)
      .catch(this.handleUnauthorizedError);
  }

  static async getResponse<T = any>(
    url: string,
    params?: any,
    options?: HydraApiOptions
  ) {
    await this.validateOptions(options);

    const headers = {
      ...this.getAxiosConfig().headers,
      "Hydra-If-Modified-Since": options?.ifModifiedSince?.toUTCString(),
      "If-None-Match": options?.ifNoneMatch,
    };

    return this.instance
      .get<T>(url, {
        params,
        ...this.getAxiosConfig(),
        headers,
        validateStatus: options?.validateStatus,
        signal: options?.signal,
      })
      .then((response) => ({
        status: response.status,
        data: response.data,
        headers: response.headers,
      }))
      .catch(this.handleUnauthorizedError);
  }

  static async post<T = any>(
    url: string,
    data?: any,
    options?: HydraApiOptions
  ) {
    await this.validateOptions(options);

    return this.instance
      .post<T>(url, data, {
        ...this.getAxiosConfig(),
        signal: options?.signal,
      })
      .then((response) => response.data)
      .catch(this.handleUnauthorizedError);
  }

  static async put<T = any>(
    url: string,
    data?: any,
    options?: HydraApiOptions
  ) {
    await this.validateOptions(options);

    return this.instance
      .put<T>(url, data, {
        ...this.getAxiosConfig(),
        signal: options?.signal,
      })
      .then((response) => response.data)
      .catch(this.handleUnauthorizedError);
  }

  static async patch<T = any>(
    url: string,
    data?: any,
    options?: HydraApiOptions
  ) {
    await this.validateOptions(options);

    return this.instance
      .patch<T>(url, data, {
        ...this.getAxiosConfig(),
        signal: options?.signal,
      })
      .then((response) => response.data)
      .catch(this.handleUnauthorizedError);
  }

  static async delete<T = any>(url: string, options?: HydraApiOptions) {
    await this.validateOptions(options);

    return this.instance
      .delete<T>(url, {
        ...this.getAxiosConfig(),
        signal: options?.signal,
      })
      .then((response) => response.data)
      .catch(this.handleUnauthorizedError);
  }

  static async checkDownloadSourcesChanges(
    downloadSourceIds: string[],
    games: Array<{ shop: string; objectId: string }>,
    since: string
  ) {
    logger.info("HydraApi.checkDownloadSourcesChanges called with:", {
      downloadSourceIds,
      gamesCount: games.length,
      since,
      isLoggedIn: this.isLoggedIn(),
    });

    try {
      const result = await this.post<
        Array<{
          shop: string;
          objectId: string;
          newDownloadOptionsCount: number;
          downloadSourceIds: string[];
        }>
      >(
        "/download-sources/changes",
        {
          downloadSourceIds,
          games,
          since,
        },
        { needsAuth: true }
      );

      logger.info(
        "HydraApi.checkDownloadSourcesChanges completed successfully:",
        result
      );
      return result;
    } catch (error) {
      logger.error("HydraApi.checkDownloadSourcesChanges failed:", error);
      throw error;
    }
  }
}
