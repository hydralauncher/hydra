import { registerEvent } from "../register-event";
import { gamesSublevel } from "@main/level";

const verifyExecutablePathInUse = async (
  _event: Electron.IpcMainInvokeEvent,
  executablePath: string
) => {
  for await (const game of gamesSublevel.values()) {
    if (game.executablePath === executablePath) {
      return game;
    }
  }

  return null;
};

registerEvent("verifyExecutablePathInUse", verifyExecutablePathInUse);
