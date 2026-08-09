import type { GameLauncherStatus } from "@types";

import { WindowManager } from "./window-manager";

export const sendGameLauncherStatus = (
  status: GameLauncherStatus,
  detail: string | null = null
) => {
  const gameLauncherWindow = WindowManager.gameLauncherWindow;

  if (!gameLauncherWindow || gameLauncherWindow.isDestroyed()) return;

  gameLauncherWindow.webContents.send("game-launcher-status", {
    status,
    detail,
  });
};
