import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import type { UserProfile } from "@types";

const getUser = async (
  _event: Electron.IpcMainInvokeEvent,
  userId: string
): Promise<UserProfile | null> => {
  try {
    const profile = await HydraApi.get<UserProfile | null>(`/users/${userId}`);

    if (!profile) return null;

    const recentGames = profile.recentGames.filter((game) => game);
    const libraryGames = profile.libraryGames.filter((game) => game);

    return {
      ...profile,
      libraryGames,
      recentGames,
    };
  } catch (err) {
    return null;
  }
};

registerEvent("getUser", getUser);
