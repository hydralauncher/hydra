import { registerEvent } from "../register-event";
import { userProfileSchema } from "../helpers/validators";
import { logger } from "@main/services";
import { HydraApi } from "@main/services/hydra-api";

const getUserProfile = async (
  _event: Electron.IpcMainInvokeEvent,
  username: string
) => {
  return HydraApi.get(`/profile/${username}`)
    .then((response) => {
      const profile = userProfileSchema.parse(response.data);
      return profile;
    })
    .catch((err) => {
      logger.error(`getUserProfile: ${username}`, err);
      return null;
    });
};

registerEvent("getUserProfile", getUserProfile);
