import { userAuthRepository } from "@main/repository";
import axios, { AxiosError, AxiosInstance } from "axios";
import { WindowManager } from "./window-manager";
import url from "url";

export class HydraApi {
  private static instance: AxiosInstance;

  private static readonly EXPIRATION_OFFSET_IN_MS = 1000 * 60 * 5;

  private static secondsToMilliseconds = (seconds: number) => seconds * 1000;

  private static userAuth = {
    authToken: "",
    refreshToken: "",
    expirationTimestamp: 0,
  };

  static isLoggedIn() {
    return this.userAuth.authToken !== "";
  }

  static async handleExternalAuth(auth: string) {
    const { payload } = url.parse(auth, true).query;

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
    };

    await userAuthRepository.upsert(
      {
        id: 1,
        accessToken,
        tokenExpirationTimestamp,
        refreshToken,
      },
      ["id"]
    );

    if (WindowManager.mainWindow) {
      WindowManager.mainWindow.webContents.send("on-signin");
    }
  }

  static async setupApi() {
    this.instance = axios.create({
      baseURL: import.meta.env.MAIN_VITE_API_URL,
    });

    this.instance.interceptors.request.use(
      (request) => {
        console.log(" ---- REQUEST -----");
        console.log(request.method, request.url, request.headers, request.data);
        return request;
      },
      (error) => {
        console.log("request error", error);
        return Promise.reject(error);
      }
    );

    this.instance.interceptors.response.use(
      (response) => {
        console.log(" ---- RESPONSE -----");
        console.log(
          response.status,
          response.config.method,
          response.config.url,
          response.data
        );
        return response;
      },
      (error) => {
        console.log("response error", error);
        return Promise.reject(error);
      }
    );

    const userAuth = await userAuthRepository.findOne({
      where: { id: 1 },
    });

    this.userAuth = {
      authToken: userAuth?.accessToken ?? "",
      refreshToken: userAuth?.refreshToken ?? "",
      expirationTimestamp: userAuth?.tokenExpirationTimestamp ?? 0,
    };
  }

  private static async revalidateAccessTokenIfExpired() {
    if (!this.userAuth.authToken) throw new Error("user is not logged in");

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

        userAuthRepository.upsert(
          {
            id: 1,
            accessToken,
            tokenExpirationTimestamp,
          },
          ["id"]
        );
      } catch (err) {
        if (
          err instanceof AxiosError &&
          (err?.response?.status === 401 || err?.response?.status === 403)
        ) {
          this.userAuth = {
            authToken: "",
            expirationTimestamp: 0,
            refreshToken: "",
          };

          userAuthRepository.delete({ id: 1 });

          if (WindowManager.mainWindow) {
            WindowManager.mainWindow.webContents.send("on-signout");
          }
        }

        throw err;
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

  static async get(url: string) {
    await this.revalidateAccessTokenIfExpired();
    return this.instance.get(url, this.getAxiosConfig());
  }

  static async post(url: string, data?: any) {
    await this.revalidateAccessTokenIfExpired();
    return this.instance.post(url, data, this.getAxiosConfig());
  }

  static async put(url: string, data?: any) {
    await this.revalidateAccessTokenIfExpired();
    return this.instance.put(url, data, this.getAxiosConfig());
  }

  static async patch(url: string, data?: any) {
    await this.revalidateAccessTokenIfExpired();
    return this.instance.patch(url, data, this.getAxiosConfig());
  }
}
