import { userAuthRepository } from "@main/repository";
import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services/hydra-api";
import { WindowManager } from "@main/services";

const signout = async (_event: Electron.IpcMainInvokeEvent): Promise<void> => {
  await Promise.all([
    userAuthRepository.delete({ id: 1 }),
    HydraApi.post("/auth/logout"),
  ]).finally(() => {
    if (WindowManager.mainWindow) {
      WindowManager.mainWindow.webContents.send("on-signout");
    }
  });
};

registerEvent("signout", signout);
