import axios from "axios";
import { registerEvent } from "../register-event";
import { userProfileSchema } from "../helpers/validators";
import { logger } from "@main/services";

const getUserProfile = async (
  _event: Electron.IpcMainInvokeEvent,
  username: string
) => {
  return axios
    .get(`${process.env.API_URL}/profile/${username}`)
    .then((response) => {
      const profile = userProfileSchema.parse(response.data);
      console.log(profile);
      return profile;
    })
    .catch((err) => {
      logger.error(`getUserProfile: ${username}`, err);
      return null;
    });
};

registerEvent("getUserProfiel", getUserProfile);
