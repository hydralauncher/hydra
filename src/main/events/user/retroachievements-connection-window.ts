import { ipcMain } from "electron";

import { WindowManager } from "@main/services";

ipcMain.handle("openRetroAchievementsConnectionWindow", () => {
  WindowManager.openRetroAchievementsConnectionWindow();
});

ipcMain.handle("minimizeRetroAchievementsConnectionWindow", () => {
  WindowManager.minimizeRetroAchievementsConnectionWindow();
});

ipcMain.handle("closeRetroAchievementsConnectionWindow", () => {
  WindowManager.closeRetroAchievementsConnectionWindow();
});

ipcMain.handle("completeRetroAchievementsConnectionWindow", () => {
  WindowManager.completeRetroAchievementsConnectionWindow();
});
