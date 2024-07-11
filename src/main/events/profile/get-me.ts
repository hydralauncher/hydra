import { registerEvent } from "../register-event";
import * as Sentry from "@sentry/electron/main";
import { HydraApi } from "@main/services";
import { UserProfile } from "@types";
import { userAuthRepository } from "@main/repository";
import { UserNotLoggedInError } from "@shared";

const getMe = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<UserProfile | null> => {
  return HydraApi.get(`/profile/me`)
    .then((me) => {
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
      if (err instanceof UserNotLoggedInError) {
        return null;
      }

      return userAuthRepository.findOne({ where: { id: 1 } });
    });
};

registerEvent("getMe", getMe);
