import { getGamesRunning } from "@main/services";
import { registerEvent } from "../register-event";

const getGamesRunningEvent = async () => {
  return getGamesRunning();
};

registerEvent("getGamesRunning", getGamesRunningEvent);
