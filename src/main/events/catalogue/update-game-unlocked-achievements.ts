import { registerEvent } from "../register-event";
import { updateLocalUnlockedAchivements } from "@main/services/achievements/update-local-unlocked-achivements";

const updateGameUnlockedAchievements = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string
) => {
  return updateLocalUnlockedAchivements(false, objectId);
};

registerEvent("updateGameUnlockedAchievements", updateGameUnlockedAchievements);
