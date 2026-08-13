import axios, { AxiosInstance } from "axios";
import https from "node:https";

export interface RetroAchievementsApiAchievement {
  ID: number;
  Title: string;
  Description: string;
  Points: number;
  BadgeName: string;
  DateEarned?: string;
  DateEarnedHardcore?: string;
}

export interface RetroAchievementsGameInfoAndUserProgress {
  Achievements: Record<string, RetroAchievementsApiAchievement>;
}

interface GetGameInfoAndUserProgressParams {
  username: string;
  webApiKey: string;
  raGameId: number;
}

export class RetroAchievementsClient {
  private static readonly instance: AxiosInstance = axios.create({
    baseURL: "https://retroachievements.org/API",
    httpsAgent: new https.Agent({ family: 4 }),
  });

  static async getGameInfoAndUserProgress({
    username,
    webApiKey,
    raGameId,
  }: GetGameInfoAndUserProgressParams) {
    const response =
      await this.instance.get<RetroAchievementsGameInfoAndUserProgress>(
        "/API_GetGameInfoAndUserProgress.php",
        { params: { u: username, y: webApiKey, g: raGameId } }
      );

    return response.data;
  }
}
