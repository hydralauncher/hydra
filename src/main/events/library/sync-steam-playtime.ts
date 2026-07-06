import { registerEvent } from "../register-event";
import { syncSteamPlaytimeForLibrary, WindowManager } from "@main/services";

const syncSteamPlaytime = async (): Promise<number> => {
  const updatedCount = await syncSteamPlaytimeForLibrary();

  if (updatedCount > 0) {
    WindowManager.sendToAppWindows("on-library-batch-complete");
  }

  return updatedCount;
};

registerEvent("syncSteamPlaytime", syncSteamPlaytime);
