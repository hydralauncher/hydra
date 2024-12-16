import { gameRepository } from "@main/repository";

import { registerEvent } from "../register-event";
import { parseExecutablePath } from "../helpers/parse-executable-path";

const updateExecutablePath = async (
  _event: Electron.IpcMainInvokeEvent,
  id: number,
  executablePath: string | null
) => {
  const parsedPath = executablePath
    ? parseExecutablePath(executablePath)
    : null;

  return gameRepository.update(
    {
      id,
    },
    {
      executablePath: parsedPath,
    }
  );
};

registerEvent("updateExecutablePath", updateExecutablePath);
