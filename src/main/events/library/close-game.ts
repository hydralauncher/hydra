import { registerEvent } from "../register-event";
import { logger } from "@main/services";
import sudo from "sudo-prompt";
import { app } from "electron";
import { PythonRPC } from "@main/services/python-rpc";
import { ProcessPayload } from "@main/services/download/types";
import { gamesSublevel, levelKeys } from "@main/level";
import { GameShop } from "@types";

const getKillCommand = (pid: number) => {
  if (process.platform == "win32") {
    return `taskkill /PID ${pid}`;
  }

  return `kill -9 ${pid}`;
};

const closeGame = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const processes =
    (await PythonRPC.rpc.get<ProcessPayload[] | null>("/process-list")).data ||
    [];

  const game = await gamesSublevel.get(levelKeys.game(shop, objectId));

  if (!game) return;

  const gameProcess = processes.find((runningProcess) => {
    if (process.platform === "linux") {
      return runningProcess.name === game.executablePath?.split("/").at(-1);
    } else {
      return runningProcess.exe === game.executablePath;
    }
  });

  if (gameProcess) {
    try {
      process.kill(gameProcess.pid);
    } catch (err) {
      sudo.exec(
        getKillCommand(gameProcess.pid),
        { name: app.getName() },
        (error, _stdout, _stderr) => {
          logger.error(error);
        }
      );
    }
  }
};

registerEvent("closeGame", closeGame);
