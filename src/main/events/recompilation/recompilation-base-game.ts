import type { Game, RecompilationDetails, RecompilationRef } from "@types";

import { gamesSublevel, levelKeys } from "@main/level";
import { HydraApi } from "@main/services/hydra-api";
import { createGame } from "@main/services/library-sync";
import { WindowManager } from "@main/services/window-manager";

const SHOP = "launchbox";

const fetchBaseGameDetails = (ref: RecompilationRef) =>
  HydraApi.get<RecompilationDetails>(
    `/games/launchbox/${ref.objectId}/recompilations/${ref.slug}`,
    undefined,
    { needsAuth: false }
  )
    .then((details) => details.game)
    .catch(() => null);

export const getOrAddBaseGame = async (
  ref: RecompilationRef
): Promise<Game> => {
  const key = levelKeys.game(SHOP, ref.objectId);
  const existing = await gamesSublevel.get(key);
  if (existing && !existing.isDeleted) {
    if (!existing.remoteId && HydraApi.isLoggedIn()) {
      await createGame(existing).catch(() => {});
    }
    return existing;
  }

  const details = await fetchBaseGameDetails(ref);
  const game: Game = existing
    ? {
        ...existing,
        isDeleted: false,
        addedToLibraryAt: new Date(),
        platform: existing.platform ?? details?.platform ?? null,
      }
    : {
        title: details?.title ?? ref.slug,
        iconUrl: details?.iconUrl ?? null,
        libraryHeroImageUrl: details?.libraryHeroImageUrl ?? null,
        logoImageUrl: details?.logoImageUrl ?? null,
        objectId: ref.objectId,
        shop: SHOP,
        remoteId: null,
        isDeleted: false,
        playTimeInMilliseconds: 0,
        lastTimePlayed: null,
        addedToLibraryAt: new Date(),
        platform: details?.platform ?? null,
        source: "hydra",
      };
  await gamesSublevel.put(key, game);
  WindowManager.sendToAppWindows("on-library-batch-complete");
  if (HydraApi.isLoggedIn()) await createGame(game).catch(() => {});
  return game;
};

export const addBaseGameIfMissing = async (ref: RecompilationRef) => {
  const existing = await gamesSublevel
    .get(levelKeys.game(SHOP, ref.objectId))
    .catch(() => undefined);
  if (existing) return;
  await getOrAddBaseGame(ref);
};
