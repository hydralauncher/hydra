import { WindowManager } from "@main/services";
import { ipcMain } from "electron";

ipcMain.handle("openGameInMainWindow", (_event, gamePath: string) => {
  // Only game detail routes; the path is built by the renderer.
  if (!gamePath.startsWith("/game/")) return;

  WindowManager.focusMainWindowAndNavigate(gamePath);
});
