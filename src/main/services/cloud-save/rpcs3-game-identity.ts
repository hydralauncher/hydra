import type { Game, Rpcs3DiscIdentityStatus } from "@types";

import { HydraApi } from "../hydra-api.js";
import { extractVerifiedPs3TitleId } from "../emulators/extract-disc-sku.js";
import {
  cacheRpcs3CatalogueTitleIds,
  rememberRpcs3CatalogueTitleIds,
} from "./rpcs3-savedata-title-ids.js";
import {
  inspectRpcs3DiscIdentity,
  rpcs3TitleIdsFromCatalogue,
  type Rpcs3CatalogueEntry,
} from "./rpcs3-game-identity-policy.js";

export { assertRpcs3SnapshotIdentity } from "./rpcs3-game-identity-policy.js";

export const getRpcs3CatalogueTitleIds = async (game: Game) => {
  let entries: Rpcs3CatalogueEntry[];
  try {
    entries = await HydraApi.post<Rpcs3CatalogueEntry[]>(
      "/games/shop-details",
      { shop: "launchbox", objectIds: [game.objectId] },
      { needsAuth: false }
    );
  } catch {
    throw new Error("cloud_save_rpcs3_catalogue_unavailable");
  }
  const ids = rpcs3TitleIdsFromCatalogue(entries, game.objectId);
  if (!ids.size) throw new Error("cloud_save_rpcs3_catalogue_unavailable");
  rememberRpcs3CatalogueTitleIds(game, ids);
  await cacheRpcs3CatalogueTitleIds(game, ids).catch(() => undefined);
  return ids;
};

export const getRpcs3DiscIdentityStatus = async (
  game: Game
): Promise<Rpcs3DiscIdentityStatus> => {
  if (!(game.discs ?? []).some((disc) => disc.path.trim())) {
    return { status: "missing", path: null, titleId: null };
  }
  try {
    return await inspectRpcs3DiscIdentity(
      game,
      await getRpcs3CatalogueTitleIds(game),
      extractVerifiedPs3TitleId
    );
  } catch {
    return { status: "catalogue-unavailable", path: null, titleId: null };
  }
};

export const assertRpcs3DiscIdentity = async (game: Game) => {
  if (!(game.discs ?? []).some((disc) => disc.path.trim())) {
    throw new Error("cloud_save_rpcs3_disc_missing");
  }
  const allowedTitleIds = await getRpcs3CatalogueTitleIds(game);
  const status = await inspectRpcs3DiscIdentity(
    game,
    allowedTitleIds,
    extractVerifiedPs3TitleId
  );
  if (status.status !== "ready") {
    throw new Error(
      `cloud_save_rpcs3_disc_${status.status.replaceAll("-", "_")}`
    );
  }
  return allowedTitleIds;
};
