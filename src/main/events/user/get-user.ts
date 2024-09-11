import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import { steamGamesWorker } from "@main/workers";
import type { UserProfile } from "@types";
import { getUserFriends } from "./get-user-friends";
import { steamUrlBuilder } from "@shared";

const getUser = async (
  _event: Electron.IpcMainInvokeEvent,
  userId: string
): Promise<UserProfile | null> => {
  try {
    const [profile, friends] = await Promise.all([
      HydraApi.get<UserProfile | null>(`/users/${userId}`),
      getUserFriends(userId, 12, 0).catch(() => {
        return { totalFriends: 0, friends: [] };
      }),
    ]);

    if (!profile) return null;

    const recentGames = await Promise.all(
      profile.recentGames.map(async (game) => {
        const steamGame = await steamGamesWorker.run(Number(game.objectId), {
          name: "getById",
        });

        return {
          ...game,
          title: steamGame.name,
          iconUrl: steamUrlBuilder.icon(game.objectId, steamGame.clientIcon),
        };
      })
    );

    // const libraryGames = await Promise.all(
    //   profile.libraryGames.map(async (game) => {
    //     return getSteamUserGame(game);
    //   })
    // );

    // const currentGame = await getGameRunning(profile.currentGame);

    return {
      ...profile,
      // libraryGames,
      recentGames,
      friends: friends.friends,
      totalFriends: friends.totalFriends,
      // currentGame,
    };
  } catch (err) {
    return null;
  }
};

registerEvent("getUser", getUser);
