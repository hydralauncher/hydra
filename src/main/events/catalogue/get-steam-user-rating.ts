import { getSteamAppRating } from "@main/services";
import { registerEvent } from "../register-event";

const getSteamUserRating = async (
  _event: Electron.IpcMainInvokeEvent,
  gameID: string
) => {
  return getSteamAppRating(gameID);
};

registerEvent("getSteamUserRating", getSteamUserRating);
