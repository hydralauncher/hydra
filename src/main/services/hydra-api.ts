import {
  userAuthRepository,
  userSubscriptionRepository,
} from "@main/repository";
import axios, { AxiosError, AxiosInstance } from "axios";
import { WindowManager } from "./window-manager";
import url from "url";
import { uploadGamesBatch } from "./library-sync";
import { clearGamesRemoteIds } from "./library-sync/clear-games-remote-id";
import { logger } from "./logger";
import { UserNotLoggedInError, SubscriptionRequiredError } from "@shared";
import { omit } from "lodash-es";
import { appVersion } from "@main/constants";
import { getUserData } from "./user/get-user-data";
import { isFuture, isToday } from "date-fns";

interface HydraApiOptions {
  needsAuth?: boolean;
  needsSubscription?: boolean;
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

  private static secondsToMilliseconds = (seconds: number) => seconds * 1000;

  private static userAuth: HydraApiUserAuth = {
    authToken: "",
    refreshToken: "",
    expirationTimestamp: 0,
    subscription: null,
  };

  private static isLoggedIn() {
    return this.userAuth.authToken !== "";
  }

  private static hasActiveSubscription() {
    const expiresAt = this.userAuth.subscription?.expiresAt;
    return expiresAt && (isFuture(expiresAt) || isToday(expiresAt));
  }

  static async handleExternalAuth(uri: string) {
    const { payload } = url.parse(uri, true).query;

    const decodedBase64 = atob(payload as string);
    const jsonData = JSON.parse(decodedBase64);

    const { accessToken, expiresIn, refreshToken } = jsonData;

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

    await userAuthRepository.upsert(
      {
        id: 1,
        accessToken,
        tokenExpirationTimestamp,
        refreshToken,
      },
      ["id"]
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
      uploadGamesBatch();
    }
  }

  static handleSignOut() {
    this.userAuth = {
      authToken: "",
      refreshToken: "",
      expirationTimestamp: 0,
      subscription: null,
    };

    this.post("/auth/logout", {}, { needsAuth: false }).catch(() => {});
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
          const data = JSON.parse(config.data);

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
          } else if (error.request) {
            const errorData = error.toJSON();
            logger.error("Request error:", errorData.message);
          } else {
            logger.error("Error", error.message);
          }
          logger.error(" ----- END RESPONSE ERROR -------");
          return Promise.reject(error);
        }
      );
    }

    const userAuth = await userAuthRepository.findOne({
      where: { id: 1 },
      relations: { subscription: true },
    });

    this.userAuth = {
      authToken: userAuth?.accessToken ?? "",
      refreshToken: userAuth?.refreshToken ?? "",
      expirationTimestamp: userAuth?.tokenExpirationTimestamp ?? 0,
      subscription: userAuth?.subscription
        ? { expiresAt: userAuth.subscription?.expiresAt }
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
    if (WindowManager.mainWindow) {
      WindowManager.mainWindow.webContents.send("on-signout");
    }
  }

  private static async revalidateAccessTokenIfExpired() {
    const now = new Date();

    if (this.userAuth.expirationTimestamp < now.getTime()) {
      try {
        const response = await this.instance.post(`/auth/refresh`, {
          refreshToken: this.userAuth.refreshToken,
        });

        const { accessToken, expiresIn } = response.data;

        const tokenExpirationTimestamp =
          now.getTime() +
          this.secondsToMilliseconds(expiresIn) -
          this.EXPIRATION_OFFSET_IN_MS;

        this.userAuth.authToken = accessToken;
        this.userAuth.expirationTimestamp = tokenExpirationTimestamp;

        logger.log(
          "Token refreshed. New expiration:",
          this.userAuth.expirationTimestamp
        );

        userAuthRepository.upsert(
          {
            id: 1,
            accessToken,
            tokenExpirationTimestamp,
          },
          ["id"]
        );
      } catch (err) {
        this.handleUnauthorizedError(err);
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

  private static handleUnauthorizedError = (err) => {
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

      userAuthRepository.delete({ id: 1 });
      userSubscriptionRepository.delete({ id: 1 });

      this.sendSignOutEvent();
    }

    throw err;
  };

  private static async validateOptions(options?: HydraApiOptions) {
    const needsAuth = options?.needsAuth == undefined || options.needsAuth;
    const needsSubscription = options?.needsSubscription === true;

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
    await this.validateOptions(options);

    return this.instance
      .get<T>(url, { params, ...this.getAxiosConfig() })
      .then((response) => response.data)
      .catch(this.handleUnauthorizedError);
  }

  static async post<T = any>(
    url: string,
    data?: any,
    options?: HydraApiOptions
  ) {
    await this.validateOptions(options);

    return this.instance
      .post<T>(url, data, this.getAxiosConfig())
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
      .put<T>(url, data, this.getAxiosConfig())
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
      .patch<T>(url, data, this.getAxiosConfig())
      .then((response) => response.data)
      .catch(this.handleUnauthorizedError);
  }

  static async delete<T = any>(url: string, options?: HydraApiOptions) {
    await this.validateOptions(options);

    return this.instance
      .delete<T>(url, this.getAxiosConfig())
      .then((response) => response.data)
      .catch(this.handleUnauthorizedError);
  }
}
