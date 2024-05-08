import { gameRepository } from "@main/repository";

import { registerEvent } from "../register-event";

const changeExecutablePath = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number,
  newExecutablePath: string
) => {
  await gameRepository.update(
    {
      id: gameId,
    },
    {
      executablePath: newExecutablePath,
    }
  );
};

registerEvent(changeExecutablePath, {
  name: "changeExecutablePath",
});
