import { userAuthRepository } from "@main/repository";
import axios, { AxiosError, AxiosInstance } from "axios";
import { WindowManager } from "./window-manager";

export class HydraApi {
  private static instance: AxiosInstance;

  private static readonly EXPIRATION_OFFSET_IN_MS = 1000 * 60 * 5;

  private static userAuth = {
    authToken: "",
    refreshToken: "",
    expirationTimestamp: 0,
  };

  static isLoggedIn() {
    return this.userAuth.authToken !== "";
  }

  static async handleExternalAuth(auth: string) {
    const decodedBase64 = atob(auth);
    const jsonData = JSON.parse(decodedBase64);

    const { accessToken, expiresIn, refreshToken } = jsonData;

    const now = new Date();

    const tokenExpirationTimestamp =
      now.getTime() + expiresIn - this.EXPIRATION_OFFSET_IN_MS;

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
          now.getTime() + expiresIn - this.EXPIRATION_OFFSET_IN_MS;

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
          this.userAuth.authToken = "";
          this.userAuth.expirationTimestamp = 0;

          if (WindowManager.mainWindow) {
            WindowManager.mainWindow.webContents.send("on-signout");
          }

          userAuthRepository.delete({ id: 1 });
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

  static async put(url, data?: any) {
    await this.revalidateAccessTokenIfExpired();
    return this.instance.put(url, data, this.getAxiosConfig());
  }

  static async patch(url, data?: any) {
    await this.revalidateAccessTokenIfExpired();
    return this.instance.patch(url, data, this.getAxiosConfig());
  }
}
