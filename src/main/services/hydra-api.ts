import { refreshTokenSchema } from "@main/events/helpers/validators";
import { userPreferencesRepository } from "@main/repository";
import axios, { AxiosInstance } from "axios";

export class HydraApi {
  private static instance: AxiosInstance;

  private static readonly EXPIRATION_OFFSET_IN_MS = 1000 * 60 * 5;

  private static userAuth = {
    authToken: "",
    refreshToken: "",
    expirationTimestamp: 0,
  };

  static async setupApi() {
    this.instance = axios.create({
      baseURL: import.meta.env.MAIN_VITE_API_URL,
    });

    const userPreferences = await userPreferencesRepository.findOne({
      where: { id: 1 },
    });

    this.userAuth = {
      authToken: userPreferences?.accessToken ?? "",
      refreshToken: userPreferences?.refreshToken ?? "",
      expirationTimestamp: userPreferences?.tokenExpirationTimestamp ?? 0,
    };
  }

  private static async revalidateAccessTokenIfExpired() {
    const now = new Date();
    if (this.userAuth.expirationTimestamp > now.getTime()) {
      const response = await this.instance.post(`/auth/refresh`, {
        refreshToken: this.userAuth.refreshToken,
      });

      const { accessToken, expiresIn } = refreshTokenSchema.parse(
        response.data
      );

      const tokenExpirationTimestamp =
        now.getTime() + expiresIn - this.EXPIRATION_OFFSET_IN_MS;

      this.userAuth.authToken = accessToken;
      this.userAuth.expirationTimestamp = tokenExpirationTimestamp;

      userPreferencesRepository.upsert(
        {
          id: 1,
          accessToken,
          tokenExpirationTimestamp,
        },
        ["id"]
      );
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
    this.revalidateAccessTokenIfExpired();
    return this.instance.get(url, this.getAxiosConfig());
  }

  static async post(url: string, data?: any) {
    this.revalidateAccessTokenIfExpired();
    return this.instance.post(url, data, this.getAxiosConfig());
  }

  static async put(url, data?: any) {
    this.revalidateAccessTokenIfExpired();
    return this.instance.put(url, data, this.getAxiosConfig());
  }

  static async patch(url, data?: any) {
    this.revalidateAccessTokenIfExpired();
    return this.instance.patch(url, data, this.getAxiosConfig());
  }
}
