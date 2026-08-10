import path from "node:path";
import fs from "node:fs";

import { getDownloadsPath } from "../helpers/get-downloads-path";
import { registerEvent } from "../register-event";
import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { GameShop } from "@types";

const getGameInstallerActionType = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
): Promise<"install" | "open-folder"> => {
  const downloadKey = levelKeys.game(shop, objectId);
  const download = await downloadsSublevel.get(downloadKey);

  if (!download?.folderName) return "open-folder";

  // Installers don't delete themselves after running, so a setup.exe check
  // alone would offer "Install" forever, even for a game that's already
  // been detected as installed (see rescanAndBindExecutableAfterInstall in
  // open-game-installer.ts). Once executablePath is set, there's nothing
  // left to install here.
  const game = await gamesSublevel.get(downloadKey);
  if (game?.executablePath) return "open-folder";

  const gamePath = path.join(
    download.downloadPath ?? (await getDownloadsPath()),
    download.folderName
  );

  if (!fs.existsSync(gamePath)) {
    return "open-folder";
  }

  // macOS always opens folder
  if (process.platform === "darwin") {
    return "open-folder";
  }

  // If path is a file, it will show in folder (open-folder behavior)
  if (fs.lstatSync(gamePath).isFile()) {
    return "open-folder";
  }

  // Check for setup.exe
  const setupPath = path.join(gamePath, "setup.exe");
  if (fs.existsSync(setupPath)) {
    return "install";
  }

  // Check if there's exactly one .exe file
  const gamePathFileNames = fs.readdirSync(gamePath);
  const gamePathExecutableFiles = gamePathFileNames.filter(
    (fileName: string) => path.extname(fileName).toLowerCase() === ".exe"
  );

  if (gamePathExecutableFiles.length === 1) {
    return "install";
  }

  // Otherwise, opens folder
  return "open-folder";
};

registerEvent("getGameInstallerActionType", getGameInstallerActionType);
