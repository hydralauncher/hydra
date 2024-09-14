import { registerEvent } from "../register-event";
import * as Sentry from "@sentry/electron/main";
import { HydraApi, logger } from "@main/services";
import { UserProfile } from "@types";
import { userAuthRepository } from "@main/repository";
import { steamUrlBuilder, UserNotLoggedInError } from "@shared";
import { steamGamesWorker } from "@main/workers";

const getSteamGame = async (objectId: string) => {
  try {
    const steamGame = await steamGamesWorker.run(Number(objectId), {
      name: "getById",
    });

    return {
      title: steamGame.name,
      iconUrl: steamUrlBuilder.icon(objectId, steamGame.clientIcon),
    };
  } catch (err) {
    logger.error("Failed to get Steam game", err);

    return null;
  }
};

const getMe = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<UserProfile | null> => {
  return HydraApi.get(`/profile/me`)
    .then(async (me) => {
      userAuthRepository.upsert(
        {
          id: 1,
          displayName: me.displayName,
          profileImageUrl: me.profileImageUrl,
          userId: me.id,
        },
        ["id"]
      );

      if (me.currentGame) {
        const steamGame = await getSteamGame(me.currentGame.objectId);

        if (steamGame) {
          me.currentGame = {
            ...me.currentGame,
            ...steamGame,
          };
        }
      }

      Sentry.setUser({ id: me.id, username: me.username });

      return me;
    })
    .catch(async (err) => {
      if (err instanceof UserNotLoggedInError) {
        return null;
      }

      const loggedUser = await userAuthRepository.findOne({ where: { id: 1 } });

      if (loggedUser) {
        return { ...loggedUser, id: loggedUser.userId };
      }

      return null;
    });
};

registerEvent("getMe", getMe);
