import { registerEvent } from "../register-event";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ASSETS_PATH } from "@main/constants";

const copyCustomGameAsset = async (
  _event: Electron.IpcMainInvokeEvent,
  sourcePath: string,
  assetType: "icon" | "logo" | "hero"
): Promise<string> => {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error("Source file does not exist");
  }

  const assetsRoot = ASSETS_PATH();

  if (!fs.existsSync(assetsRoot)) {
    fs.mkdirSync(assetsRoot, { recursive: true });
  }

  const customGamesAssetsPath = path.join(assetsRoot, "custom-games");
  if (!fs.existsSync(customGamesAssetsPath)) {
    fs.mkdirSync(customGamesAssetsPath, { recursive: true });
  }

  const fileExtension = path.extname(sourcePath);

  const uniqueId = randomUUID();
  const fileName = `${assetType}-${uniqueId}${fileExtension}`;
  const destinationPath = path.join(customGamesAssetsPath, fileName);

  await fs.promises.copyFile(sourcePath, destinationPath);

  return `local:${destinationPath}`;
};

registerEvent("copyCustomGameAsset", copyCustomGameAsset);
