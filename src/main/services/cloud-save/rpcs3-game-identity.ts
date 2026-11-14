import type { Game, Rpcs3DiscIdentityStatus } from "@types";

import { extractVerifiedPs3TitleId } from "../emulators/extract-disc-sku.js";
import { fetchCatalogueTitleIds } from "./catalogue-title-ids.js";
import { inspectRpcs3DiscIdentity } from "./rpcs3-game-identity-policy.js";

export { assertRpcs3SnapshotIdentity } from "./rpcs3-game-identity-policy.js";

export const getRpcs3CatalogueTitleIds = async (game: Game) => {
  const ids = await fetchCatalogueTitleIds(game).catch(() => null);
  if (!ids?.size) throw new Error("cloud_save_rpcs3_catalogue_unavailable");
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
