import { registerEvent } from "../register-event";
import * as Sentry from "@sentry/electron/main";
import { HydraApi } from "@main/services";
import { ProfileVisibility, UserDetails } from "@types";
import { userAuthRepository } from "@main/repository";
import { UserNotLoggedInError } from "@shared";

const getMe = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<UserDetails | null> => {
  return HydraApi.get<UserDetails>(`/profile/me`)
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

      Sentry.setUser({ id: me.id, username: me.username });

      return me;
    })
    .catch(async (err) => {
      if (err instanceof UserNotLoggedInError) {
        return null;
      }

      const loggedUser = await userAuthRepository.findOne({ where: { id: 1 } });

      if (loggedUser) {
        return {
          ...loggedUser,
          id: loggedUser.userId,
          username: "",
          bio: "",
          profileVisibility: "PUBLIC" as ProfileVisibility,
        };
      }

      return null;
    });
};

registerEvent("getMe", getMe);
