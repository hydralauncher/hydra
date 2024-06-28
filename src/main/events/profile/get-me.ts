import { registerEvent } from "../register-event";
import * as Sentry from "@sentry/electron/main";
import { HydraApi } from "@main/services";
import { UserProfile } from "@types";
import { userAuthRepository } from "@main/repository";
import { logger } from "@main/services";

const getMe = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<UserProfile | null> => {
  return HydraApi.get(`/profile/me`)
    .then((response) => {
      const me = response.data;

      userAuthRepository.upsert(
        {
          id: 1,
          displayName: me.displayName,
          profileImageUrl: me.profileImageUrl,
          userId: me.id,
        },
        ["id"]
      );

      Sentry.setUser({ id: me.id, username: me.username });

      return me;
    })
    .catch((err) => {
      logger.error("getMe", err);
      return userAuthRepository.findOne({ where: { id: 1 } });
    });
};

registerEvent("getMe", getMe);
