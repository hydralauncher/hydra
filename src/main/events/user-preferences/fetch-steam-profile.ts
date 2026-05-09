import { db, levelKeys } from "@main/level";
import { SteamProfileApi } from "@main/services/steam-profile-api";
import type { UserPreferences } from "@types";
import { registerEvent } from "../register-event";

const fetchSteamProfile = async (_event: Electron.IpcMainInvokeEvent) => {
  const userPreferences = await db.get<string, UserPreferences>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );

  const { steamLinkedAccountId, steamApiKey } = userPreferences;

  if (!steamLinkedAccountId || !steamApiKey) {
    throw new Error("steam_not_configured");
  }

  const summary = await SteamProfileApi.getPlayerSummary(
    steamLinkedAccountId,
    steamApiKey
  );

  if (!summary) throw new Error("steam_profile_not_found");

  return {
    displayName: summary.personaname,
    avatarUrl: summary.avatarfull,
  };
};

registerEvent("fetchSteamProfile", fetchSteamProfile);
