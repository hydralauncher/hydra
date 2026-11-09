import {
  gameRequestQueue,
  HYDRA_GAME_REQUEST_TIMEOUT_MS,
} from "./game-request-queue";
import { getHydraPlaytimeRevision } from "./library-write-queue";
import type { Game } from "@types";
import { HydraApi } from "../hydra-api";
import { gamesSublevel, levelKeys } from "@main/level";
import { mergeLocalAndRemotePlayTime } from "@shared";
import type { RemotePlayTimeInput } from "../../../shared/playtime";
import { libraryWriteQueue, withHydraClaim } from "./library-write-queue";

export const createGame = async (game: Game) => {
  if (game.shop === "custom" || game.source === "epic") return;
  const context = HydraApi.getAuthContext();
  const key = levelKeys.game(game.shop, game.objectId);
  const current = () =>
    context
      ? HydraApi.isAuthContextCurrent(context)
      : HydraApi.getAuthContext() === null;
  return withHydraClaim(key, () =>
    gameRequestQueue.run(
      [key],
      async () => {
        const revision = getHydraPlaytimeRevision();
        const local = await gamesSublevel.get(key);
        if (!local || local.isDeleted || local.source === "epic") return;
        try {
          const response = await HydraApi.post<
            RemotePlayTimeInput & {
              id: string;
              createdAt?: string;
              lastTimePlayed?: Date | null;
            }
          >(
            "/profile/games",
            {
              objectId: game.objectId,
              playTimeInMilliseconds: Math.trunc(
                local.playTimeInMilliseconds ?? 0
              ),
              shop: game.shop,
              lastTimePlayed: local.lastTimePlayed,
            },
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
              remoteId: response.id,
              source: "hydra",
              ...mergeLocalAndRemotePlayTime(latest, response),
              ...(getHydraPlaytimeRevision(key) > revision
                ? { playTimeInMilliseconds: latest.playTimeInMilliseconds }
                : {}),
              addedToLibraryAt:
                latest.addedToLibraryAt ??
                (response.createdAt
                  ? new Date(response.createdAt)
                  : new Date()),
              lastTimePlayed:
                latest.lastTimePlayed ?? response.lastTimePlayed ?? null,
            });
          }, current);
        } catch (error) {
          if (current())
            await libraryWriteQueue.run(async () => {
              const latest = await gamesSublevel.get(key);
              if (latest)
                await gamesSublevel.put(key, {
                  ...latest,
                  source: "hydra",
                  remoteId: null,
                });
            }, current);
          throw error;
        }
      },
      current
    )
  );
};
