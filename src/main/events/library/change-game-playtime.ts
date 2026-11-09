import { HydraApi } from "@main/services";
import { registerEvent } from "../register-event";
import type { GameShop } from "@types";
import { gamesSublevel, levelKeys } from "@main/level";
import {
  libraryWriteQueue,
  withHydraClaim,
  markHydraPlaytimeChanged,
} from "../../services/library-sync/library-write-queue";
import {
  gameRequestQueue,
  HYDRA_GAME_REQUEST_TIMEOUT_MS,
} from "../../services/library-sync/game-request-queue";
import { resetHydraPlaytimeTicks } from "../../services/game-running-state";

const changeGamePlaytime = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  playTimeInSeconds: number
) => {
  const key = levelKeys.game(shop, objectId);
  const context = HydraApi.getAuthContext();
  const current = () =>
    context
      ? HydraApi.isAuthContextCurrent(context)
      : HydraApi.getAuthContext() === null;
  return withHydraClaim(key, () =>
    gameRequestQueue.run(
      [key],
      async () => {
        const game = await gamesSublevel.get(key);
        if (!game) return;
        if (game.remoteId)
          await HydraApi.put(
            `/profile/games/${shop}/${encodeURIComponent(objectId)}/playtime`,
            { playTimeInSeconds },
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
            source: "hydra",
            playTimeInMilliseconds: playTimeInSeconds * 1000,
            hasManuallyUpdatedPlaytime: true,
            unsyncedDeltaPlayTimeInMilliseconds: 0,
          });
          markHydraPlaytimeChanged(key);
          resetHydraPlaytimeTicks(key);
        }, current);
      },
      current
    )
  );
};
registerEvent("changeGamePlayTime", changeGamePlaytime);
