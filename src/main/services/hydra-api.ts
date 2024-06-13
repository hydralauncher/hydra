import { userPreferencesRepository } from "@main/repository";
import axios, { AxiosInstance } from "axios";

export class HydraApi {
  private static instance: AxiosInstance;

  static authToken = "";
  static refreshToken = "";

  static async createInstance() {
    this.instance = axios.create({
      baseURL: import.meta.env.MAIN_VITE_API_URL,
    });

    const userPreferences = await userPreferencesRepository.findOne({
      where: { id: 1 },
    });

    this.authToken = userPreferences?.accessToken ?? "";
    this.refreshToken = userPreferences?.refreshToken ?? "";

    this.instance.interceptors.request.use(
      (config) => {
        config.headers.Authorization = `Bearer ${this.authToken}`;
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    this.instance.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;
        if (error.response.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;
          const refreshToken = this.refreshToken;

          if (!refreshToken) return error;

          try {
            const response = await axios.post(
              `${import.meta.env.MAIN_VITE_API_URL}/auth/refresh`,
              { refreshToken }
            );
            const newAccessToken = response.data.accessToken;
            this.authToken = newAccessToken;

            userPreferencesRepository.upsert(
              {
                id: 1,
                accessToken: newAccessToken,
              },
              ["id"]
            );

            originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
            return axios(originalRequest); //recall Api with new token
          } catch (err) {
            this.authToken = "";
            this.refreshToken = "";
            return error;
          }
        }

        return error;
      }
    );
  }

  static async get(url: string) {
    return this.instance.get(url);
  }

  static async post(url: string, data?: any) {
    return this.instance.post(url, data);
  }

  static async put(url, data?: any) {
    return this.instance.put(url, data);
  }

  static async patch(url, data?: any) {
    return this.instance.patch(url, data);
  }
}
