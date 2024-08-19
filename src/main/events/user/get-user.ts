import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import { steamGamesWorker } from "@main/workers";
import { UserGame, UserProfile } from "@types";
import { convertSteamGameToCatalogueEntry } from "../helpers/search-games";
import { getSteamAppAsset } from "@main/helpers";
import { getUserFriends } from "./get-user-friends";

const getUser = async (
  _event: Electron.IpcMainInvokeEvent,
  userId: string
): Promise<UserProfile | null> => {
  try {
    const [profile, friends] = await Promise.all([
      HydraApi.get(`/users/${userId}`),
      getUserFriends(userId, 12, 0).catch(() => {
        return { totalFriends: 0, friends: [] };
      }),
    ]);

    const recentGames = await Promise.all(
      profile.recentGames.map(async (game) => {
        return getSteamUserGame(game);
      })
    );

    const libraryGames = await Promise.all(
      profile.libraryGames.map(async (game) => {
        return getSteamUserGame(game);
      })
    );

    return {
      ...profile,
      libraryGames,
      recentGames,
      friends: friends.friends,
      totalFriends: friends.totalFriends,
      currentGame: profile.currentGame
        ? getSteamUserGame(profile.currentGame)
        : null,
    };
  } catch (err) {
    return null;
  }
};

const getSteamUserGame = async (game): Promise<UserGame> => {
  const steamGame = await steamGamesWorker.run(Number(game.objectId), {
    name: "getById",
  });
  const iconUrl = steamGame?.clientIcon
    ? getSteamAppAsset("icon", game.objectId, steamGame.clientIcon)
    : null;

  return {
    ...game,
    ...convertSteamGameToCatalogueEntry(steamGame),
    iconUrl,
  };
};

registerEvent("getUser", getUser);
