import { getSteamAppRating } from "@main/services";
import { registerEvent } from "../register-event";

const getSteamUserRating = async (
  _event: Electron.IpcMainInvokeEvent,
  objectID: string
) => {
  return getSteamAppRating(objectID);
};

registerEvent("getSteamUserRating", getSteamUserRating);
