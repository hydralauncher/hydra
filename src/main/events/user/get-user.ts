import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import { steamGamesWorker } from "@main/workers";
import { GameRunning, UserGame, UserProfile } from "@types";
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

    const currentGame = await getGameRunning(profile.currentGame);

    return {
      ...profile,
      libraryGames,
      recentGames,
      friends: friends.friends,
      totalFriends: friends.totalFriends,
      currentGame,
    };
  } catch (err) {
    return null;
  }
};

const getGameRunning = async (currentGame): Promise<GameRunning | null> => {
  if (!currentGame) {
    return null;
  }

  const gameRunning = await getSteamUserGame(currentGame);

  return {
    ...gameRunning,
    sessionDurationInMillis: currentGame.sessionDurationInSeconds * 1000,
  };
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
