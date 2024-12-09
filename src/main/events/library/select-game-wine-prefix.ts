import { gameRepository } from "@main/repository";

import { registerEvent } from "../register-event";

const selectGameWinePrefix = async (
  _event: Electron.IpcMainInvokeEvent,
  id: number,
  winePrefixPath: string | null
) => {
  return gameRepository.update({ id }, { winePrefixPath: winePrefixPath });
};

registerEvent("selectGameWinePrefix", selectGameWinePrefix);
