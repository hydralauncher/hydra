import type { GameLauncherStatus, GameLauncherStatusPayload } from "@types";

import { WindowManager } from "./window-manager";

type GameLauncherStatusGroup = "compatibility" | "achievements";

const COMPATIBILITY_STATUSES = new Set<GameLauncherStatus>([
  "preparing_compatibility_layer",
  "compatibility_layer_ready",
  "compatibility_layer_failed",
]);

const latestStatuses = new Map<
  string,
  Map<GameLauncherStatusGroup, GameLauncherStatusPayload>
>();

const getStatusGroup = (status: GameLauncherStatus): GameLauncherStatusGroup =>
  COMPATIBILITY_STATUSES.has(status) ? "compatibility" : "achievements";

export const getGameLauncherStatuses = (gameKey: string) => [
  ...(latestStatuses.get(gameKey)?.values() ?? []),
];

export const clearGameLauncherStatuses = (gameKey: string) => {
  latestStatuses.delete(gameKey);
};

export const sendGameLauncherStatus = (
  gameKey: string,
  status: GameLauncherStatus,
  detail: string | null = null
) => {
  const payload: GameLauncherStatusPayload = { gameKey, status, detail };
  const statuses = latestStatuses.get(gameKey) ?? new Map();
  statuses.set(getStatusGroup(status), payload);
  latestStatuses.set(gameKey, statuses);

  const gameLauncherWindow = WindowManager.gameLauncherWindow;

  if (!gameLauncherWindow || gameLauncherWindow.isDestroyed()) return;

  gameLauncherWindow.webContents.send("game-launcher-status", payload);
};
