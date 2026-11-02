import type { GameLauncherStatus, GameLauncherStatusPayload } from "@types";

const COMPATIBILITY_LAUNCHER_STATUSES = new Set<GameLauncherStatus>([
  "preparing_compatibility_layer",
  "compatibility_layer_ready",
  "compatibility_layer_failed",
  "game_started",
]);

export const getLauncherStatusGroup = (status: GameLauncherStatus) =>
  COMPATIBILITY_LAUNCHER_STATUSES.has(status)
    ? "compatibility"
    : "achievements";

export const createLauncherStatusReplay = (gameKey: string) => {
  const liveStatusGroups = new Set<string>();

  return {
    acceptLiveStatus: (payload: GameLauncherStatusPayload) => {
      if (payload.gameKey !== gameKey) return false;
      liveStatusGroups.add(getLauncherStatusGroup(payload.status));
      return true;
    },
    selectCachedStatuses: (payloads: GameLauncherStatusPayload[]) =>
      payloads.filter(
        (payload) =>
          payload.gameKey === gameKey &&
          !liveStatusGroups.has(getLauncherStatusGroup(payload.status))
      ),
  };
};

export type CompatibilityLayerStatus = "idle" | "preparing" | "failed";

export const getGameLauncherActions = ({
  isMainWindowOpen,
  compatibilityLayerStatus,
}: {
  isMainWindowOpen: boolean;
  compatibilityLayerStatus: CompatibilityLayerStatus;
}) => ({
  showOpenHydra: !isMainWindowOpen,
  showClose: compatibilityLayerStatus !== "idle",
});

export const GAME_LAUNCHER_AUTO_CLOSE_DELAY_MS = 5_000;
export const GAME_STARTED_AUTO_CLOSE_DELAY_MS = 1_000;

export const getGameLauncherAutoCloseDelay = (gameStarted: boolean) =>
  gameStarted
    ? GAME_STARTED_AUTO_CLOSE_DELAY_MS
    : GAME_LAUNCHER_AUTO_CLOSE_DELAY_MS;

export const canGameLauncherAutoClose = ({
  preflightFinished,
  isGeneratingAchievements,
  compatibilityLayerStatus,
}: {
  preflightFinished: boolean;
  isGeneratingAchievements: boolean;
  compatibilityLayerStatus: CompatibilityLayerStatus;
}) =>
  preflightFinished &&
  !isGeneratingAchievements &&
  compatibilityLayerStatus === "idle";
