import { registerEvent } from "../register-event";
import { userProfileSchema } from "../helpers/validators";
import { logger } from "@main/services";
import { HydraApi } from "@main/services/hydra-api";
import { steamGamesWorker } from "@main/workers";
import { LibraryGame, SteamGame, UserProfile } from "@types";

const getUserProfile = async (
  _event: Electron.IpcMainInvokeEvent,
  username: string
): Promise<UserProfile | null> => {
  try {
    const response = await HydraApi.get(`/profile/${username}`);
    const profile = userProfileSchema.parse(response.data);

    const recentGames = await Promise.all(
      profile.recentGames.map(async (game) => {
        const steamGame = await steamGamesWorker.run(Number(game.objectId), {
          name: "getById",
        });

        return { ...game, title: steamGame.name, objectId: game.objectId };
      })
    );

    const libraryGames = await Promise.all(
      profile.game.map(async (game) => {
        const steamGame = await steamGamesWorker.run(Number(game.objectId), {
          name: "getById",
        });
        return { ...game, title: steamGame.name, objectID: game.objectId };
      })
    );

    return { ...profile, game: libraryGames, recentGames };
  } catch (err) {
    logger.error(`getUserProfile: ${username}`, err);
    return null;
  }
};

registerEvent("getUserProfile", getUserProfile);
