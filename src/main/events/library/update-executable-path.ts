import { gameRepository } from "@main/repository";

import { registerEvent } from "../register-event";

const updateExecutablePath = async (
  _event: Electron.IpcMainInvokeEvent,
  id: number,
  executablePath: string
) => {
  return gameRepository.update(
    {
      id,
    },
    {
      executablePath,
    }
  );
};

registerEvent("updateExecutablePath", updateExecutablePath);
