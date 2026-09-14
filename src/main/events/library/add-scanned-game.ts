import { registerEvent } from "../register-event";
import { addGameOutsideLibrary } from "./scan-installed-games";
import { WindowManager } from "@main/services";

const addScannedGame = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  executablePath: string
) => {
  const addedGame = await addGameOutsideLibrary(objectId, executablePath);

  if (addedGame) WindowManager.sendToAppWindows("on-library-batch-complete");

  return addedGame;
};

registerEvent("addScannedGame", addScannedGame);
