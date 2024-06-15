import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services/hydra-api";
import { UserProfile } from "@types";
import { userAuthRepository } from "@main/repository";

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
          profileImageUrl: me.displayName,
          userId: me.id,
        },
        ["id"]
      );

      return me;
    })
    .catch(() => {
      return userAuthRepository.findOne({ where: { id: 1 } });
    });
};

registerEvent("getMe", getMe);
