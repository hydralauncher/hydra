import { HydraApi } from "@main/services";
import { registerEvent } from "../register-event";
import type { GameShop } from "@types";
import { gamesSublevel, levelKeys } from "@main/level";
import {
  libraryWriteQueue,
  markHydraPlaytimeChanged,
} from "../../services/library-sync/library-write-queue";
import {
  gameRequestQueue,
  HYDRA_GAME_REQUEST_TIMEOUT_MS,
} from "../../services/library-sync/game-request-queue";
import { resetHydraPlaytimeTicks } from "../../services/game-running-state";

const resetGamePlaytime = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const key = levelKeys.game(shop, objectId);
  const context = HydraApi.getAuthContext();
  const current = () =>
    context
      ? HydraApi.isAuthContextCurrent(context)
      : HydraApi.getAuthContext() === null;
  return gameRequestQueue.run(
    [key],
    async () => {
      const game = await gamesSublevel.get(key);
      if (!game) return;
      if (game.remoteId)
        await HydraApi.delete(
          `/profile/games/${shop}/${encodeURIComponent(objectId)}/playtime`,
          {
            ...(context ? { authContext: context } : {}),
            timeout: HYDRA_GAME_REQUEST_TIMEOUT_MS,
          }
        );
      await libraryWriteQueue.run(async () => {
        const latest = await gamesSublevel.get(key);
        if (!latest) return;
        await gamesSublevel.put(key, {
          ...latest,
          playTimeInMilliseconds: 0,
          lastTimePlayed: null,
          hasManuallyUpdatedPlaytime: false,
          unsyncedDeltaPlayTimeInMilliseconds: 0,
        });
        markHydraPlaytimeChanged(key);
        resetHydraPlaytimeTicks(key);
      }, current);
    },
    current
  );
};
registerEvent("resetGamePlayTime", resetGamePlaytime);
