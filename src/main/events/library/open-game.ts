import { exec as execCallback } from 'child_process';
import { gameRepository } from "@main/repository";
import { registerEvent } from "../register-event";
import { shell } from "electron";
import { promisify } from 'node:util';
import { logger } from "@main/services";

const exec = promisify(execCallback);

const escapeShellPath = (path: string) => {
  if (process.platform === 'win32') {
    return `"${path}"`;
  } else {
    return path.replace(/ /g, '\\ ').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }
};

const openGame = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number,
  executablePath: string
) => {
  try {
    await gameRepository.update({ id: gameId }, { executablePath });

    if (process.platform === 'linux') {
      const { stdout: lutrisPath } = await exec('which lutris');
      if (lutrisPath.trim()) {
        await exec(`chmod +x "${executablePath}"`);
        const escapedPath = escapeShellPath(executablePath);
        try {
          await exec(`lutris -e "${escapedPath}"`);
        } catch (err) {
          logger.error('Error launching with Lutris:', err);
        }
      }
    } else {
      shell.openPath(executablePath);
    }
  } catch (err) {
    logger.error('Failed operation:', err);
  }
};

registerEvent(openGame, {
  name: "openGame",
});
