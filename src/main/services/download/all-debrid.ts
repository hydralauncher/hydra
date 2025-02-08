import axios, { AxiosInstance } from "axios";
import type { AllDebridUser } from "@types";
import { logger } from "@main/services";

export class AllDebridClient {
    private static instance: AxiosInstance;
    private static readonly baseURL = "https://api.alldebrid.com/v4";

    static authorize(apiKey: string) {
        logger.info("[AllDebrid] Authorizing with key:", apiKey ? "***" : "empty");
        this.instance = axios.create({
          baseURL: this.baseURL,
          params: {
            agent: "hydra",
            apikey: apiKey
          }
        });
    }

    static async getUser() {
        try {
            const response = await this.instance.get<{
                status: string;
                data?: { user: AllDebridUser };
                error?: {
                    code: string;
                    message: string;
                };
            }>("/user");

            logger.info("[AllDebrid] API Response:", response.data);

            if (response.data.status === "error") {
                const error = response.data.error;
                logger.error("[AllDebrid] API Error:", error);
                if (error?.code === "AUTH_MISSING_APIKEY") {
                    return { error_code: "alldebrid_missing_key" };
                }
                if (error?.code === "AUTH_BAD_APIKEY") {
                    return { error_code: "alldebrid_invalid_key" };
                }
                if (error?.code === "AUTH_BLOCKED") {
                    return { error_code: "alldebrid_blocked" };
                }
                if (error?.code === "AUTH_USER_BANNED") {
                    return { error_code: "alldebrid_banned" };
                }
                return { error_code: "alldebrid_unknown_error" };
            }

            if (!response.data.data?.user) {
                logger.error("[AllDebrid] No user data in response");
                return { error_code: "alldebrid_invalid_response" };
            }

            logger.info("[AllDebrid] Successfully got user:", response.data.data.user.username);
            return { user: response.data.data.user };
        } catch (error: any) {
            logger.error("[AllDebrid] Request Error:", error);
            if (error.response?.data?.error) {
                return { error_code: "alldebrid_invalid_key" };
            }
            return { error_code: "alldebrid_network_error" };
        }
    }
}
