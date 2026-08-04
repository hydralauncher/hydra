import type { GameLauncherStatus } from "@types";

import { WindowManager } from "./window-manager";

/**
 * Pushes a status line to the game launcher window. Work started during launch
 * can outlive the window, so every send is guarded.
 */
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
