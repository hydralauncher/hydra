import { userSubscriptionRepository } from "@main/repository";
import axios from "axios";
import { appVersion } from "@main/constants";

export class HydraAnalytics {
  private static instance = axios.create({
    baseURL: import.meta.env.MAIN_VITE_ANALYTICS_API_URL,
    headers: { "User-Agent": `Hydra Launcher v${appVersion}` },
  });

  private static async hasActiveSubscription() {
    const userSubscription = await userSubscriptionRepository.findOne({
      where: { id: 1 },
    });

    return (
      userSubscription?.expiresAt && userSubscription.expiresAt > new Date()
    );
  }

  static async postDownload(hash: string) {
    const hasSubscription = await this.hasActiveSubscription();

    return this.instance
      .post("/track", {
        event: "download",
        attributes: {
          hash,
          hasSubscription,
        },
      })
      .then((response) => response.data);
  }
}
