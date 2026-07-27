import { registerEvent } from "../register-event";
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

interface SaveUserScreenshotsParams {
  shop: string;
  objectId: string;
  screenshots: { name: string; data: Uint8Array }[];
}

const saveUserScreenshots = async (
  _event: Electron.IpcMainInvokeEvent,
  params: SaveUserScreenshotsParams
): Promise<string[]> => {
  const { shop, objectId, screenshots } = params;

  const userDataPath = app.getPath("userData");
  const screenshotsDir = path.join(userDataPath, "user-screenshots", shop, objectId);

  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const savedPaths: string[] = [];

  for (const screenshot of screenshots) {
    const fileName = `${Date.now()}-${screenshot.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
    const filePath = path.join(screenshotsDir, fileName);

    fs.writeFileSync(filePath, Buffer.from(screenshot.data));
    savedPaths.push(filePath);
  }

  return savedPaths;
};

registerEvent("saveUserScreenshots", saveUserScreenshots);