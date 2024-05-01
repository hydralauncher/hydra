import { exec as execCallback } from 'child_process';
import { gameRepository } from "@main/repository";
import { registerEvent } from "../register-event";
import { shell } from "electron";
import { promisify } from 'util';

const exec = promisify(execCallback);

const escapeShellPath = (path: string) => {
  // Escapes spaces, parentheses for commands
  return path.replace(/ /g, '\\ ').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
};

const openGame = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number,
  executablePath: string
) => {
  try {
    await gameRepository.update({ id: gameId }, { executablePath });
    await exec(`chmod +x "${executablePath}"`);

    const { stdout: lutrisPath } = await exec('which lutris');
    
    if (lutrisPath.trim()) {
      const escapedPath = escapeShellPath(executablePath);
      try {
        // Lutris is installed, use it to open the game
        await exec(`lutris -e "${escapedPath}"`);
      } catch (err) {
        console.error('Error launching with Lutris:', err);
      }
    } else {
      // Lutris is not installed, use the default method
      shell.openPath(executablePath);
    }
  } catch (err) {
    console.error('Failed operation:', err);
  }
};

registerEvent(openGame, {
  name: "openGame",
});
