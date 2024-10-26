import { gameRepository } from "@main/repository";

import { registerEvent } from "../register-event";

const selectGameWinePrefix = async (
  _event: Electron.IpcMainInvokeEvent,
  id: number,
  winePrefixPath: string
) => {
  return gameRepository.update({ id }, { winePrefixPath });
};

registerEvent("selectGameWinePrefix", selectGameWinePrefix);
