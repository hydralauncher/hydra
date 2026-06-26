import { registerEvent } from "../register-event";
import { HydraApi, WindowManager } from "@main/services";
import { uploadGamesBatch } from "@main/services/library-sync";
import { clearGamesRemoteIds } from "@main/services/library-sync/clear-games-remote-id";
import { db } from "@main/level";
import { levelKeys } from "@main/level/sublevels";
import type { UserPreferences } from "@types";
import { logger } from "@main/services/logger";

const selfHostedSignIn = async (
  _event: Electron.IpcMainInvokeEvent,
  userToken: string
) => {
  logger.log("selfHostedSignIn called, token length:", userToken?.length);
  HydraApi.setSelfHostedUserToken(userToken);

  const prefs = await db.get<string, UserPreferences>(levelKeys.userPreferences, { valueEncoding: "json" });
  await db.put<string, UserPreferences>(
    levelKeys.userPreferences,
    { ...prefs, selfHostedUserToken: userToken },
    { valueEncoding: "json" }
  );

  if (WindowManager.mainWindow) {
    WindowManager.mainWindow.webContents.send("on-signin");
    logger.log("selfHostedSignIn: clearing remote IDs and uploading batch");
    await clearGamesRemoteIds();
    void uploadGamesBatch();
  } else {
    logger.log("selfHostedSignIn: no mainWindow");
  }
};

registerEvent("selfHostedSignIn", selfHostedSignIn);
