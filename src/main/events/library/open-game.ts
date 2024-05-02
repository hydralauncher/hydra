import { exec as execCallback } from 'child_process';
import { gameRepository } from "@main/repository";
import { registerEvent } from "../register-event";
import { shell } from "electron";
import { promisify } from 'util';
import os from 'os';

const exec = promisify(execCallback);

const escapeShellPath = (path: string) => {
  if (os.platform() === 'win32') {
    // Windows paths should be enclosed in quotes if they contain spaces
    return `"${path}"`;
  } else {
    // Escapes spaces, parentheses for commands in Linux
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

    // Check for Lutris only on Linux systems
    if (os.platform() === 'linux') {
      const { stdout: lutrisPath } = await exec('which lutris');
      if (lutrisPath.trim()) {
        // Lutris is installed
        await exec(`chmod +x "${executablePath}"`); // Make executable only if Lutris is found
        const escapedPath = escapeShellPath(executablePath);
        try {
          await exec(`lutris -e "${escapedPath}"`); // Use Lutris to open the game
        } catch (err) {
          console.error('Error launching with Lutris:', err);
        }
      }
    } else {
      // For non-Linux systems, just open the path
      shell.openPath(executablePath);
    }
  } catch (err) {
    console.error('Failed operation:', err);
  }
};

registerEvent(openGame, {
  name: "openGame",
});