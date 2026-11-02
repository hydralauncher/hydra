import {
  gameRequestQueue,
  HYDRA_GAME_REQUEST_TIMEOUT_MS,
} from "./game-request-queue";
import { levelKeys } from "@main/level";
import { clearStaleEpicImports } from "../epic/import-cleanup";
import { chunk } from "lodash-es";
import { HydraApi } from "../hydra-api";
import { mergeWithRemoteGames } from "./merge-with-remote-games";
import { WindowManager } from "../window-manager";
import { AchievementWatcherManager } from "../achievements/achievement-watcher-manager";
import { gamesSublevel } from "@main/level";
import { trackRemoteLibrarySync } from "./remote-library-sync-state";

const uploadLocalGamesAndMerge = async () => {
  const context = HydraApi.getAuthContext();
  const current = () =>
    context
      ? HydraApi.isAuthContextCurrent(context)
      : HydraApi.getAuthContext() === null;
  await clearStaleEpicImports(context, current);
  if (!current()) return;
  const games = await gamesSublevel
    .values()
    .all()
    .then((results) => {
      return results.filter(
        (game) =>
          !game.isDeleted &&
          game.remoteId === null &&
          game.shop !== "custom" &&
          game.source !== "epic"
      );
    });

  const gamesChunks = chunk(games, 30);

  for (const chunk of gamesChunks) {
    if (!current()) return;
    const keys = chunk.map((game) => levelKeys.game(game.shop, game.objectId));
    await gameRequestQueue
      .run(
        keys,
        async () => {
          const latest = (await gamesSublevel.getMany(keys)).filter(
            (game): game is NonNullable<typeof game> =>
              !!game &&
              !game.isDeleted &&
              game.remoteId === null &&
              game.source !== "epic"
          );
          if (!latest.length) return;
          await HydraApi.post(
            "/profile/games/batch",
            latest.map((game) => ({
              objectId: game.objectId,
              playTimeInMilliseconds: Math.trunc(game.playTimeInMilliseconds),
              shop: game.shop,
              lastTimePlayed: game.lastTimePlayed,
              isFavorite: game.favorite,
              isPinned: game.isPinned ?? false,
            })),
            {
              ...(context ? { authContext: context } : {}),
              timeout: HYDRA_GAME_REQUEST_TIMEOUT_MS,
            }
          );
        },
        () =>
          context
            ? HydraApi.isAuthContextCurrent(context)
            : HydraApi.getAuthContext() === null
      )
      .catch(() => {});
  }

  if (!current()) return;
  await mergeWithRemoteGames(undefined, context ?? undefined);

  AchievementWatcherManager.preSearchAchievements();

  if (WindowManager.mainWindow)
    WindowManager.sendToAppWindows("on-library-batch-complete");
};

export const uploadGamesBatch = () =>
  trackRemoteLibrarySync(uploadLocalGamesAndMerge);
