import type { GameLauncherStatus, GameLauncherStatusPayload } from "@types";

const COMPATIBILITY_LAUNCHER_STATUSES = new Set<GameLauncherStatus>([
  "preparing_compatibility_layer",
  "compatibility_layer_ready",
  "compatibility_layer_failed",
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

export const getGameLauncherActions = ({
  isMainWindowOpen,
  isCompatibilityLayerFailed,
}: {
  isMainWindowOpen: boolean;
  isCompatibilityLayerFailed: boolean;
}) => ({
  showOpenHydra: !isMainWindowOpen,
  showClose: isCompatibilityLayerFailed,
});
