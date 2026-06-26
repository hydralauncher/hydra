import axios, { AxiosError, AxiosInstance } from "axios";
import { WindowManager } from "./window-manager";
import url from "url";
import { uploadGamesBatch } from "./library-sync";
import { clearGamesRemoteIds } from "./library-sync/clear-games-remote-id";
import { networkLogger as logger } from "./logger";
import { UserNotLoggedInError, SubscriptionRequiredError } from "@shared";
import { omit } from "lodash-es";
import { appVersion } from "@main/constants";
import { getUserData } from "./user/get-user-data";
import { db } from "@main/level";
import { levelKeys } from "@main/level/sublevels";
import type { Auth, User } from "@types";
import { WSClient } from "./ws";

export interface HydraApiOptions {
  needsAuth?: boolean;
  needsSubscription?: boolean;
  ifModifiedSince?: Date;
}

interface HydraApiUserAuth {
  authToken: string;
  refreshToken: string;
  expirationTimestamp: number;
  subscription: { expiresAt: Date | string | null } | null;
}

export class HydraApi {
  private static instance: AxiosInstance;
  private static officialInstance: AxiosInstance;

  private static readonly EXPIRATION_OFFSET_IN_MS = 1000 * 60 * 5; // 5 minutes
  private static readonly ADD_LOG_INTERCEPTOR = true;

  private static readonly OFFICIAL_ONLY_PREFIXES = [
    "/catalogue",
    "/games/",
    "/decky",
    "/auth/ws",
  ];

  private static readonly OFFICIAL_ONLY_SUFFIXES = ["/reviews"];

  private static selfHostedConfig: {
    url: string;
    masterToken: string;
    userToken: string | null;
  } | null = null;

  public static setSelfHostedConfig(
    url: string,
    masterToken: string,
    userToken?: string | null
  ) {
    this.selfHostedConfig = { url, masterToken, userToken: userToken ?? null };
    if (this.instance) this.instance.defaults.baseURL = url;
  }

  public static setSelfHostedUserToken(userToken: string) {
    if (this.selfHostedConfig) this.selfHostedConfig.userToken = userToken;
  }

  public static clearSelfHostedConfig() {
    this.selfHostedConfig = null;
    if (this.instance)
      this.instance.defaults.baseURL = import.meta.env.MAIN_VITE_API_URL;
  }

  public static isSelfHosted() {
    return this.selfHostedConfig !== null;
  }

  public static getOfficialUserAuth() {
    if (!this.userAuth.authToken) return null;
    return this.userAuth;
  }

  public static async getOfficialProfile() {
    if (!this.userAuth.authToken) return null;
    return this.officialInstance
      .get("/profile/me", {
        headers: { Authorization: `Bearer ${this.userAuth.authToken}` },
      })
      .then((r) => r.data)
      .catch(() => null);
  }

  public static isSelfHostedAuthenticated() {
    return this.selfHostedConfig?.userToken != null;
  }

  private static officialAuthHeaders() {
    if (!this.userAuth.authToken) return {};
    return { Authorization: `Bearer ${this.userAuth.authToken}` };
  }

  public static async patchOfficial<T = unknown>(
    url: string,
    data?: unknown
  ): Promise<T> {
    return this.officialInstance
      .patch<T>(url, data, { headers: this.officialAuthHeaders() })
      .then((r) => r.data);
  }

  public static async postOfficial<T = unknown>(
    url: string,
    data?: unknown
  ): Promise<T> {
    return this.officialInstance
      .post<T>(url, data, { headers: this.officialAuthHeaders() })
      .then((r) => r.data);
  }

  private static readonly UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  private static isOfficialOnlyUrl(url: string) {
    if (this.OFFICIAL_ONLY_PREFIXES.some((prefix) => url.startsWith(prefix)))
      return true;
    if (this.OFFICIAL_ONLY_SUFFIXES.some((suffix) => url.includes(suffix)))
      return true;
    // /users/<id> — route to official if id is not a UUID (official uses short IDs)
    const usersMatch = url.match(/^\/users\/([^/?]+)/);
    if (usersMatch && !this.UUID_REGEX.test(usersMatch[1])) return true;
    return false;
  }

  private static getInstanceForUrl(url: string): AxiosInstance {
    if (this.selfHostedConfig && !this.isOfficialOnlyUrl(url)) {
      return this.instance;
    }
    return this.officialInstance ?? this.instance;
  }

  private static secondsToMilliseconds(seconds: number) {
    return seconds * 1000;
  }

  private static userAuth: HydraApiUserAuth = {
    authToken: "",
    refreshToken: "",
    expirationTimestamp: 0,
    subscription: null,
  };

  public static isLoggedIn() {
    return this.userAuth.authToken !== "";
  }

  public static hasActiveSubscription() {
    if (this.selfHostedConfig) return true;
    const expiresAt = new Date(this.userAuth.subscription?.expiresAt ?? 0);
    return expiresAt > new Date();
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
      if (this.selfHostedConfig) {
        // Official login while self-hosted is active — just notify UI, don't disturb self-hosted sync
        WindowManager.mainWindow.webContents.send("on-official-signin");
      } else {
        WindowManager.mainWindow.webContents.send("on-signin");
        await clearGamesRemoteIds();
        void uploadGamesBatch();

        WSClient.close();
        WSClient.connect();

        const { syncDownloadSourcesFromApi } = await import("./user");
        syncDownloadSourcesFromApi();
      }
    }
  }

  static handleSignOut() {
    this.userAuth = {
      authToken: "",
      refreshToken: "",
      expirationTimestamp: 0,
      subscription: null,
    };

    this.sendSignOutEvent();
    this.post("/auth/logout", {}, { needsAuth: false }).catch(() => {});
  }

  static async setupApi() {
    this.instance = axios.create({
      baseURL: import.meta.env.MAIN_VITE_API_URL,
      headers: { "User-Agent": `Hydra Launcher v${appVersion}` },
    });

    this.officialInstance = axios.create({
      baseURL: import.meta.env.MAIN_VITE_API_URL,
      headers: { "User-Agent": `Hydra Launcher v${appVersion}` },
    });

    if (this.ADD_LOG_INTERCEPTOR) {
      this.instance.interceptors.request.use(
        (request) => {
          logger.log(" ---- REQUEST -----");
          const data = Array.isArray(request.data)
            ? request.data
            : omit(request.data, ["refreshToken"]);
          logger.log(request.method, request.url, request.params, data);
          return request;
        },
        (error) => {
          logger.error("request error", error);
          return Promise.reject(error);
        }
      );
      this.instance.interceptors.response.use(
        (response) => {
          logger.log(" ---- RESPONSE -----");
          const data = Array.isArray(response.data)
            ? response.data
            : omit(response.data, ["username", "accessToken", "refreshToken"]);
          logger.log(
            response.status,
            response.config.method,
            response.config.url,
            data
          );
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

    const result = await db.getMany<string>(
      [levelKeys.auth, levelKeys.user, levelKeys.userPreferences],
      { valueEncoding: "json" }
    );

    const userAuth = result.at(0) as Auth | undefined;
    const user = result.at(1) as User | undefined;
    const userPreferences = result.at(2) as
      | import("@types").UserPreferences
      | undefined;

    if (
      userPreferences?.selfHostedApiUrl &&
      userPreferences?.selfHostedApiToken
    ) {
      this.setSelfHostedConfig(
        userPreferences.selfHostedApiUrl,
        userPreferences.selfHostedApiToken,
        userPreferences.selfHostedUserToken
      );
    }

    this.userAuth = {
      authToken: userAuth?.accessToken ?? "",
      refreshToken: userAuth?.refreshToken ?? "",
      expirationTimestamp: userAuth?.tokenExpirationTimestamp ?? 0,
      subscription: user?.subscription
        ? { expiresAt: user.subscription?.expiresAt }
        : null,
    };

    if (!this.selfHostedConfig) {
      const updatedUserData = await getUserData();

      this.userAuth.subscription = updatedUserData?.subscription
        ? {
            expiresAt: updatedUserData.subscription.expiresAt,
          }
        : null;
    } else if (this.selfHostedConfig.userToken) {
      // Self-hosted with userToken — sync library on startup
      const { uploadGamesBatch } = await import("./library-sync");
      await clearGamesRemoteIds();
      void uploadGamesBatch();
    }
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
        this.handleUnauthorizedError(err);
      }
    }
  }

  private static getAxiosConfig(url?: string) {
    const useSelfHosted =
      this.selfHostedConfig && url && !this.isOfficialOnlyUrl(url);
    if (useSelfHosted) {
      const token =
        this.selfHostedConfig!.userToken ?? this.selfHostedConfig!.masterToken;
      return { headers: { Authorization: `Bearer ${token}` } };
    }
    // Official request — use official token if available
    if (this.userAuth.authToken) {
      return {
        headers: { Authorization: `Bearer ${this.userAuth.authToken}` },
      };
    }
    return { headers: {} };
  }

  private static readonly handleUnauthorizedError = (err) => {
    if (err instanceof AxiosError && err.response?.status === 401) {
      if (this.selfHostedConfig) throw err;

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

      this.sendSignOutEvent();
    }

    throw err;
  };

  private static async validateOptions(url: string, options?: HydraApiOptions) {
    const isOfficial = !this.selfHostedConfig || this.isOfficialOnlyUrl(url);

    const needsAuth = options?.needsAuth == undefined || options.needsAuth;
    const needsSubscription = options?.needsSubscription === true;

    if (!isOfficial) return;

    // In self-hosted mode, official-only requests are best-effort (no official JWT)
    if (this.selfHostedConfig) return;

    if (needsAuth) {
      if (!this.isLoggedIn()) throw new UserNotLoggedInError();
      await this.revalidateAccessTokenIfExpired();
    }

    if (needsSubscription && !this.hasActiveSubscription()) {
      throw new SubscriptionRequiredError();
    }
  }

  static async get<T = any>(
    url: string,
    params?: any,
    options?: HydraApiOptions
  ) {
    await this.validateOptions(url, options);

    const headers = {
      ...this.getAxiosConfig(url).headers,
      "Hydra-If-Modified-Since": options?.ifModifiedSince?.toUTCString(),
    };

    return this.getInstanceForUrl(url)
      .get<T>(url, { params, ...this.getAxiosConfig(url), headers })
      .then((response) => response.data)
      .catch(this.handleUnauthorizedError);
  }

  static async post<T = any>(
    url: string,
    data?: any,
    options?: HydraApiOptions
  ) {
    await this.validateOptions(url, options);

    return this.getInstanceForUrl(url)
      .post<T>(url, data, this.getAxiosConfig(url))
      .then((response) => response.data)
      .catch(this.handleUnauthorizedError);
  }

  static async put<T = any>(
    url: string,
    data?: any,
    options?: HydraApiOptions
  ) {
    await this.validateOptions(url, options);

    return this.getInstanceForUrl(url)
      .put<T>(url, data, this.getAxiosConfig(url))
      .then((response) => response.data)
      .catch(this.handleUnauthorizedError);
  }

  static async patch<T = any>(
    url: string,
    data?: any,
    options?: HydraApiOptions
  ) {
    await this.validateOptions(url, options);

    return this.getInstanceForUrl(url)
      .patch<T>(url, data, this.getAxiosConfig(url))
      .then((response) => response.data)
      .catch(this.handleUnauthorizedError);
  }

  static async delete<T = any>(url: string, options?: HydraApiOptions) {
    await this.validateOptions(url, options);

    return this.getInstanceForUrl(url)
      .delete<T>(url, this.getAxiosConfig(url))
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
