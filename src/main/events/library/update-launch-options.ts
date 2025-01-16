import { gameRepository } from "@main/repository";
import { registerEvent } from "../register-event";

const updateLaunchOptions = async (
  _event: Electron.IpcMainInvokeEvent,
  id: number,
  launchOptions: string | null
) => {
  return gameRepository.update(
    {
      id,
    },
    {
      launchOptions: launchOptions?.trim() != "" ? launchOptions : null,
    }
  );
};

registerEvent("updateLaunchOptions", updateLaunchOptions);
