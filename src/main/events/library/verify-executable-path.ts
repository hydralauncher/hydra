import { gameRepository } from "@main/repository";
import { registerEvent } from "../register-event";

const verifyExecutablePathInUse = async (
  _event: Electron.IpcMainInvokeEvent,
  executablePath: string
) => {
  return gameRepository.findOne({
    where: { executablePath },
  });
};

registerEvent("verifyExecutablePathInUse", verifyExecutablePathInUse);
