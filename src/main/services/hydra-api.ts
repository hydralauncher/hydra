import axios, { AxiosError, AxiosInstance } from "axios";
import jwt from "jsonwebtoken";
import { WindowManager } from "./window-manager";
import url from "url";
import { uploadGamesBatch } from "./library-sync";
import { clearGamesRemoteIds } from "./library-sync/clear-games-remote-id";
import { networkLogger as logger } from "./logger";
import { UserNotLoggedInError, SubscriptionRequiredError } from "@shared";
import { appVersion } from "@main/constants";
import { getUserData } from "./user/get-user-data";
import { db } from "@main/level";
import { levelKeys } from "@main/level/sublevels";
import type { Auth, User } from "@types";
import { SSEClient } from "./sse";
import {
  sanitizeNetworkLogPayload,
  summarizeNetworkLogPayload,
} from "./network-log-payload";
import { summarizeNetworkError } from "./network-error-summary";
import {
  HydraAuthContextTracker,
  waitForHydraAuthRefresh,
  type HydraApiAuthContext,
} from "./hydra-auth-context";

declare module "axios" {
  interface AxiosRequestConfig {
    logResponseBody?: boolean;
  }
}

export interface HydraApiOptions {
  needsAuth?: boolean;
  needsSubscription?: boolean;
  ifModifiedSince?: Date;
  ifNoneMatch?: string;
  validateStatus?: (status: number) => boolean;
  signal?: AbortSignal;
  logResponseBody?: boolean;
  timeout?: number;
  authContext?: HydraApiAuthContext;
}

interface HydraApiUserAuth {
  authToken: string;
  refreshToken: string;
  expirationTimestamp: number;
  subscription: { expiresAt: Date | string | null } | null;
}

export class HydraApi {
  private static instance: AxiosInstance;
  private static readonly authContexts = new HydraAuthContextTracker();
  private static authPersistence: Promise<void> = Promise.resolve();
  private static refreshInFlight: {
    generation: number;
    promise: Promise<{ accessToken: string; expiresIn: number }>;
  } | null = null;

  public static getAuthContext() {
    return this.authContexts.getContext();
  }

  public static isAuthContextCurrent(context: HydraApiAuthContext) {
    return this.authContexts.isCurrent(context);
  }

  public static onAuthContextChanged(listener: () => void) {
    return this.authContexts.subscribe(listener);
  }

  private static activateAuthContext(generation: number) {
    const claims = jwt.decode(this.userAuth.authToken);
    const userId =
      claims && typeof claims === "object" && typeof claims.userId === "string"
        ? claims.userId
        : null;
    this.authContexts.activate(
      import.meta.env.MAIN_VITE_API_URL.replace(/\/+$/, ""),
      userId,
      generation
    );
  }

  private static assertAuthGeneration(generation: number) {
    if (generation !== this.authContexts.generation) {
      throw new UserNotLoggedInError();
    }
  }

  private static persistAuth(auth: Auth, generation: number) {
    return this.queueAuthPersistence(async () => {
      this.assertAuthGeneration(generation);
      await db.put<string, Auth>(levelKeys.auth, auth, {
        valueEncoding: "json",
      });
      this.assertAuthGeneration(generation);
    });
  }

  private static queueAuthPersistence(operation: () => Promise<void>) {
    const write = this.authPersistence.then(operation);
    this.authPersistence = write.catch(() => {});
    return write;
  }

  public static persistUserCache(user: User, context: HydraApiAuthContext) {
    return this.queueAuthPersistence(async () => {
      if (!this.isAuthContextCurrent(context)) throw new UserNotLoggedInError();
      await db.put<string, User>(levelKeys.user, user, {
        valueEncoding: "json",
      });
      if (!this.isAuthContextCurrent(context)) throw new UserNotLoggedInError();
    });
  }

  private static clearPersistedAuth(cleanupUserData?: () => Promise<void>) {
    // Queue immediately when the session is invalidated. A preceding write must
    // finish before deletion; a later login persists only after deletion/cleanup.
    return this.queueAuthPersistence(async () => {
      await db.batch([
        { type: "del", key: levelKeys.auth },
        { type: "del", key: levelKeys.user },
      ]);
      await cleanupUserData?.();
    });
  }

  private static readonly EXPIRATION_OFFSET_IN_MS = 1000 * 60 * 5; // 5 minutes
  private static readonly AUTH_REFRESH_TIMEOUT_MS = 20_000;
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

  public static isLoggedIn() {
    return this.userAuth.authToken !== "";
  }

  public static hasActiveSubscription() {
    const expiresAt = new Date(this.userAuth.subscription?.expiresAt ?? 0);
    return expiresAt > new Date();
  }

  public static updateUserSubscription(
    subscription?: { expiresAt: Date | string | null } | null
  ) {
    this.userAuth.subscription = subscription
      ? { expiresAt: subscription.expiresAt }
      : null;

    if (process.platform === "linux" && !this.hasActiveSubscription()) {
      void import("./linux-game-capture-session").then(
        ({ stopAllLinuxGameCaptureSessions }) => {
          if (!this.hasActiveSubscription()) {
            stopAllLinuxGameCaptureSessions();
          }
        }
      );
    }

    if (this.isLoggedIn() && this.hasActiveSubscription()) {
      void import("./achievements/grouped-souvenir-worker").then(
        ({ groupedSouvenirWorker }) => groupedSouvenirWorker.trigger()
      );
    }
  }

  static async handleExternalAuth(uri: string) {
    const { payload } = url.parse(uri, true).query;

    const decodedBase64 = atob(payload as string);
    const jsonData = JSON.parse(decodedBase64);

    const { accessToken, expiresIn, refreshToken, workwondersJwt } = jsonData;

    const generation = this.authContexts.invalidate();
    this.userAuth = {
      authToken: "",
      refreshToken: "",
      expirationTimestamp: 0,
      subscription: null,
    };

    const now = new Date();

    const tokenExpirationTimestamp =
      now.getTime() +
      this.secondsToMilliseconds(expiresIn) -
      this.EXPIRATION_OFFSET_IN_MS;

    await clearGamesRemoteIds();
    if (generation !== this.authContexts.generation) return;

    this.userAuth = {
      authToken: accessToken,
      refreshToken: refreshToken,
      expirationTimestamp: tokenExpirationTimestamp,
      subscription: null,
    };
    this.activateAuthContext(generation);

    const { AchievementWatcherManager } = await import(
      "./achievements/achievement-watcher-manager"
    );
    if (generation !== this.authContexts.generation) return;
    AchievementWatcherManager.resetSessionState();

    logger.log(
      "Sign in received. Token expiration timestamp:",
      tokenExpirationTimestamp
    );

    await this.persistAuth(
      {
        accessToken,
        refreshToken,
        tokenExpirationTimestamp,
        workwondersJwt,
      },
      generation
    ).catch((error) => {
      if (generation === this.authContexts.generation) throw error;
    });
    if (generation !== this.authContexts.generation) return;

    await getUserData().then((userDetails) => {
      if (generation !== this.authContexts.generation) return;
      if (userDetails?.subscription) {
        this.updateUserSubscription({
          expiresAt: userDetails.subscription.expiresAt
            ? new Date(userDetails.subscription.expiresAt)
            : null,
        });
      }
    });
    if (generation !== this.authContexts.generation) return;

    const { groupedSouvenirWorker } = await import(
      "./achievements/grouped-souvenir-worker"
    );
    if (generation !== this.authContexts.generation) return;
    void groupedSouvenirWorker.trigger();

    const { startSteamSyncOnStartup } = await import(
      "./steam-integration/steam-startup-sync"
    );
    if (generation !== this.authContexts.generation) return;
    void startSteamSyncOnStartup();

    if (WindowManager.mainWindow) {
      WindowManager.mainWindow.webContents.send("on-signin");
      void uploadGamesBatch();

      SSEClient.close();
      SSEClient.connect();

      const { syncDownloadSourcesFromApi } = await import("./user");
      if (generation !== this.authContexts.generation) return;
      syncDownloadSourcesFromApi();
    }
  }

  static async handleSignOut(cleanupUserData?: () => Promise<void>) {
    const generation = this.authContexts.invalidate();
    this.userAuth = {
      authToken: "",
      refreshToken: "",
      expirationTimestamp: 0,
      subscription: null,
    };

    const persistence = this.clearPersistedAuth(cleanupUserData);
    try {
      const { AchievementWatcherManager } = await import(
        "./achievements/achievement-watcher-manager"
      );
      if (generation !== this.authContexts.generation) return;
      AchievementWatcherManager.resetSessionState();
      const { stopAllLinuxGameCaptureSessions } = await import(
        "./linux-game-capture-session"
      );
      if (generation !== this.authContexts.generation) return;
      stopAllLinuxGameCaptureSessions();
      const { groupedSouvenirWorker } = await import(
        "./achievements/grouped-souvenir-worker"
      );
      if (generation !== this.authContexts.generation) return;
      groupedSouvenirWorker.stop();

      const { resetSteamStartupSync } = await import(
        "./steam-integration/steam-startup-sync"
      );
      if (generation !== this.authContexts.generation) return;
      resetSteamStartupSync();

      await persistence;
      if (generation !== this.authContexts.generation) return;
      this.sendSignOutEvent();
      // Preserve the legacy unauthenticated call without reading a future
      // account's token after an asynchronous request-validation gap.
      this.instance
        .post(
          "/auth/logout",
          {},
          {
            headers: { Authorization: "Bearer " },
            timeout: this.AUTH_REFRESH_TIMEOUT_MS,
          }
        )
        .catch(() => {});
    } finally {
      await persistence;
    }
  }

  static async setupApi() {
    this.instance = axios.create({
      baseURL: import.meta.env.MAIN_VITE_API_URL,
      headers: { "User-Agent": `Hydra Launcher v${appVersion}` },
    });

    if (this.ADD_LOG_INTERCEPTOR) {
      this.instance.interceptors.request.use(
        (request) => {
          logger.log(" ---- REQUEST -----");
          logger.log(
            request.method,
            request.url,
            sanitizeNetworkLogPayload({
              params: request.params ?? null,
              data: request.data ?? null,
            })
          );
          return request;
        },
        (error) => {
          logger.error("request error", summarizeNetworkError(error));
          return Promise.reject(error);
        }
      );
      this.instance.interceptors.response.use(
        (response) => {
          logger.log(" ---- RESPONSE -----");
          logger.log(
            response.status,
            response.config.method,
            response.config.url,
            response.config.logResponseBody === false
              ? summarizeNetworkLogPayload(response.data)
              : sanitizeNetworkLogPayload(response.data)
          );
          return response;
        },
        (error) => {
          logger.error(" ---- RESPONSE ERROR -----");
          const config = error.config ?? {};

          logger.error(
            config.method,
            config.baseURL,
            config.url,
            sanitizeNetworkLogPayload({
              headers: config.headers ?? null,
              data: config.data ?? null,
            })
          );
          if (error.response) {
            logger.error(
              "Response error:",
              error.response.status,
              sanitizeNetworkLogPayload(error.response.data)
            );

            return Promise.reject(error as Error);
          }

          if (error.request) {
            const errorData = error.toJSON();
            logger.error("Request error:", summarizeNetworkError(error));
            return Promise.reject(
              new Error(
                `Request failed with ${errorData.code} ${errorData.message}`
              )
            );
          }

          logger.error("Error", summarizeNetworkError(error));
          return Promise.reject(error as Error);
        }
      );
    }

    const result = await db.getMany<string>([levelKeys.auth, levelKeys.user], {
      valueEncoding: "json",
    });

    const userAuth = result.at(0) as Auth | undefined;
    const user = result.at(1) as User | undefined;

    this.userAuth = {
      authToken: userAuth?.accessToken ?? "",
      refreshToken: userAuth?.refreshToken ?? "",
      expirationTimestamp: userAuth?.tokenExpirationTimestamp ?? 0,
      subscription: user?.subscription
        ? { expiresAt: user.subscription?.expiresAt }
        : null,
    };
    const generation = this.authContexts.invalidate();
    this.activateAuthContext(generation);

    const updatedUserData = await getUserData();
    if (generation !== this.authContexts.generation) return;
    this.updateUserSubscription(updatedUserData?.subscription);
  }

  private static sendSignOutEvent() {
    WindowManager.sendToAppWindows("on-signout");
  }

  public static async refreshToken() {
    const generation = this.authContexts.generation;
    if (!this.isLoggedIn()) throw new UserNotLoggedInError();
    if (this.refreshInFlight?.generation === generation) {
      return this.refreshInFlight.promise;
    }
    const promise = this.performTokenRefresh(generation);
    this.refreshInFlight = { generation, promise };
    try {
      return await promise;
    } finally {
      if (this.refreshInFlight?.promise === promise)
        this.refreshInFlight = null;
    }
  }

  private static async performTokenRefresh(generation: number) {
    const previousAuth = this.userAuth;
    const response = await this.instance.post(
      `/auth/refresh`,
      {
        refreshToken: previousAuth.refreshToken,
      },
      { timeout: this.AUTH_REFRESH_TIMEOUT_MS }
    );
    this.assertAuthGeneration(generation);

    const { accessToken, expiresIn } = response.data;

    const tokenExpirationTimestamp =
      Date.now() +
      this.secondsToMilliseconds(expiresIn) -
      this.EXPIRATION_OFFSET_IN_MS;

    this.userAuth = {
      ...previousAuth,
      authToken: accessToken,
      expirationTimestamp: tokenExpirationTimestamp,
    };

    logger.log(
      "Token refreshed. New expiration:",
      this.userAuth.expirationTimestamp
    );

    await db
      .get<string, Auth>(levelKeys.auth, { valueEncoding: "json" })
      .then((auth) => {
        this.assertAuthGeneration(generation);
        return this.persistAuth(
          {
            ...auth,
            accessToken,
            tokenExpirationTimestamp,
          },
          generation
        );
      });

    return { accessToken, expiresIn };
  }

  private static async revalidateAccessTokenIfExpired(
    generation: number,
    options?: HydraApiOptions
  ) {
    if (this.userAuth.expirationTimestamp < Date.now()) {
      try {
        await waitForHydraAuthRefresh(this.refreshToken(), options ?? {});
      } catch (err) {
        await this.handleUnauthorizedError(err, generation);
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

  private static readonly handleUnauthorizedError = async (
    err: unknown,
    generation = this.authContexts.generation
  ) => {
    if (
      generation === this.authContexts.generation &&
      err instanceof AxiosError &&
      err.response?.status === 401
    ) {
      logger.error(
        "401 - Current credentials:",
        sanitizeNetworkLogPayload({
          credentials: this.userAuth,
          response: err.response?.data,
        })
      );

      const signedOutGeneration = this.authContexts.invalidate();
      this.userAuth = {
        authToken: "",
        expirationTimestamp: 0,
        refreshToken: "",
        subscription: null,
      };
      const persistence = this.clearPersistedAuth();
      try {
        const { AchievementWatcherManager } = await import(
          "./achievements/achievement-watcher-manager"
        );
        if (signedOutGeneration !== this.authContexts.generation) throw err;
        AchievementWatcherManager.resetSessionState();

        const { stopAllLinuxGameCaptureSessions } = await import(
          "./linux-game-capture-session"
        );
        if (signedOutGeneration !== this.authContexts.generation) throw err;
        stopAllLinuxGameCaptureSessions();
        const { groupedSouvenirWorker } = await import(
          "./achievements/grouped-souvenir-worker"
        );
        if (signedOutGeneration !== this.authContexts.generation) throw err;
        groupedSouvenirWorker.stop();

        await persistence;
        if (signedOutGeneration !== this.authContexts.generation) throw err;
        SSEClient.close();
        this.sendSignOutEvent();
      } finally {
        await persistence;
      }
    }

    throw err;
  };

  private static async validateOptions(options?: HydraApiOptions) {
    const generation = this.authContexts.generation;
    const needsAuth = options?.needsAuth == undefined || options.needsAuth;
    const needsSubscription = options?.needsSubscription === true;

    if (needsAuth) {
      if (!this.isLoggedIn()) throw new UserNotLoggedInError();
      if (
        options?.authContext &&
        !this.isAuthContextCurrent(options.authContext)
      ) {
        throw new UserNotLoggedInError();
      }
      await this.revalidateAccessTokenIfExpired(generation, options);
      this.assertAuthGeneration(generation);
    }

    if (needsSubscription && !this.hasActiveSubscription()) {
      await this.refreshUserSubscription();

      if (!this.hasActiveSubscription()) {
        throw new SubscriptionRequiredError();
      }
    }
    if (needsAuth) this.assertAuthGeneration(generation);
    return generation;
  }

  private static async refreshUserSubscription() {
    if (!this.isLoggedIn()) return;
    const generation = this.authContexts.generation;

    try {
      const userDetails = await getUserData();
      if (generation !== this.authContexts.generation) return;
      if (userDetails) this.updateUserSubscription(userDetails.subscription);
    } catch (err) {
      logger.error("Failed to refresh subscription state", err);
    }
  }

  private static assertRequestScope(
    options: HydraApiOptions | undefined,
    generation: number
  ) {
    if (options?.needsAuth !== false) this.assertAuthGeneration(generation);
    if (
      options?.authContext &&
      !this.isAuthContextCurrent(options.authContext)
    ) {
      throw new UserNotLoggedInError();
    }
  }

  private static requestConfig(
    options: HydraApiOptions | undefined,
    generation: number
  ) {
    this.assertRequestScope(options, generation);
    return {
      ...this.getAxiosConfig(),
      signal: options?.signal,
      timeout: options?.timeout,
      logResponseBody: options?.logResponseBody,
      ...(options?.validateStatus
        ? { validateStatus: options.validateStatus }
        : {}),
    };
  }

  private static requestError(
    err: unknown,
    options: HydraApiOptions | undefined,
    generation: number
  ) {
    if (options?.needsAuth === false) return Promise.reject(err);
    return this.handleUnauthorizedError(err, generation);
  }

  static async get<T = any>(
    url: string,
    params?: any,
    options?: HydraApiOptions
  ) {
    const generation = await this.validateOptions(options);
    const config = this.requestConfig(options, generation);
    return this.instance
      .get<T>(url, {
        ...config,
        params,
        headers: {
          ...config.headers,
          "Hydra-If-Modified-Since": options?.ifModifiedSince?.toUTCString(),
          "If-None-Match": options?.ifNoneMatch,
        },
      })
      .then((response) => {
        this.assertRequestScope(options, generation);
        return response.data;
      })
      .catch((err) => this.requestError(err, options, generation));
  }

  static async getResponse<T = any>(
    url: string,
    params?: any,
    options?: HydraApiOptions
  ) {
    const generation = await this.validateOptions(options);
    const config = this.requestConfig(options, generation);
    return this.instance
      .get<T>(url, {
        ...config,
        params,
        headers: {
          ...config.headers,
          "Hydra-If-Modified-Since": options?.ifModifiedSince?.toUTCString(),
          "If-None-Match": options?.ifNoneMatch,
        },
      })
      .then((response) => {
        this.assertRequestScope(options, generation);
        return {
          status: response.status,
          data: response.data,
          headers: response.headers,
        };
      })
      .catch((err) => this.requestError(err, options, generation));
  }

  static async post<T = any>(
    url: string,
    data?: any,
    options?: HydraApiOptions
  ) {
    const generation = await this.validateOptions(options);
    return this.instance
      .post<T>(url, data, this.requestConfig(options, generation))
      .then((response) => {
        this.assertRequestScope(options, generation);
        return response.data;
      })
      .catch((err) => this.requestError(err, options, generation));
  }

  static async postResponse<T = unknown>(
    url: string,
    data?: unknown,
    options?: HydraApiOptions
  ) {
    const generation = await this.validateOptions(options);
    return this.instance
      .post<T>(url, data, this.requestConfig(options, generation))
      .then((response) => {
        this.assertRequestScope(options, generation);
        return { status: response.status, data: response.data };
      })
      .catch((err) => this.requestError(err, options, generation));
  }

  static async put<T = any>(
    url: string,
    data?: any,
    options?: HydraApiOptions
  ) {
    const generation = await this.validateOptions(options);
    return this.instance
      .put<T>(url, data, this.requestConfig(options, generation))
      .then((response) => {
        this.assertRequestScope(options, generation);
        return response.data;
      })
      .catch((err) => this.requestError(err, options, generation));
  }

  static async patch<T = any>(
    url: string,
    data?: any,
    options?: HydraApiOptions
  ) {
    const generation = await this.validateOptions(options);
    return this.instance
      .patch<T>(url, data, this.requestConfig(options, generation))
      .then((response) => {
        this.assertRequestScope(options, generation);
        return response.data;
      })
      .catch((err) => this.requestError(err, options, generation));
  }

  static async delete<T = any>(url: string, options?: HydraApiOptions) {
    const generation = await this.validateOptions(options);
    return this.instance
      .delete<T>(url, this.requestConfig(options, generation))
      .then((response) => {
        this.assertRequestScope(options, generation);
        return response.data;
      })
      .catch((err) => this.requestError(err, options, generation));
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
