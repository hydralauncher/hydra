export const RETRO_ACHIEVEMENTS_INTEGRATION_ENDPOINT =
  "/profile/integrations/retroachievements";

export type RetroAchievementsIntegration =
  | { connected: false }
  | {
      connected: true;
      username: string;
      retroAchievementsUserId: string | null;
      retroAchievementsAccountStatus: "active" | "invalid_credentials";
    };

export type RetroAchievementsConnectErrorField =
  | "password"
  | "webApiKey"
  | "form";

export const getRetroAchievementsConnectErrorField = (
  message?: string
): RetroAchievementsConnectErrorField => {
  if (message === "profile/retroachievements-invalid-password") {
    return "password";
  }

  if (message === "profile/retroachievements-invalid-web-api-key") {
    return "webApiKey";
  }

  return "form";
};
