import type { Game, GameInstallation } from "@types";
import {
  gameInstallationsSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import {
  applyGameInstallation,
  buildGameInstallation,
  getLegacyInstallationId,
} from "./game-installation-context.js";

export {
  applyGameInstallation,
  buildGameInstallation,
  getLegacyInstallationId,
} from "./game-installation-context.js";

export const ensureGameInstallation = async (game: Game): Promise<Game> => {
  const gameKey = levelKeys.game(game.shop, game.objectId);
  const installationId =
    game.installationId ?? getLegacyInstallationId(game.shop, game.objectId);
  const current = await gameInstallationsSublevel.get(
    levelKeys.installation(installationId)
  );
  const installation = buildGameInstallation(game, installationId, current);
  await gameInstallationsSublevel.put(
    levelKeys.installation(installationId),
    installation
  );
  const merged = applyGameInstallation(game, installation);
  if (game.installationId !== installationId) {
    await gamesSublevel.put(gameKey, merged);
  }
  return merged;
};

export const updateGameInstallation = async (
  game: Game,
  patch: Partial<GameInstallation>
): Promise<Game> => {
  const resolved = await ensureGameInstallation(game);
  const installationId = resolved.installationId!;
  const current = await gameInstallationsSublevel.get(
    levelKeys.installation(installationId)
  );
  const installation = {
    ...buildGameInstallation(resolved, installationId, current),
    ...patch,
    installationId,
    canonicalGameId:
      patch.canonicalGameId ??
      resolved.canonicalGameId ??
      current?.canonicalGameId ??
      null,
    storeMappingId:
      patch.storeMappingId ??
      resolved.storeMappingId ??
      current?.storeMappingId ??
      null,
    shop: resolved.shop,
    objectId: resolved.objectId,
  } satisfies GameInstallation;
  await gameInstallationsSublevel.put(
    levelKeys.installation(installationId),
    installation
  );
  const updatedGame = applyGameInstallation(resolved, installation);
  await gamesSublevel.put(
    levelKeys.game(resolved.shop, resolved.objectId),
    updatedGame
  );
  return updatedGame;
};

export const migrateLegacyGameInstallations = async () => {
  const games = await gamesSublevel.values().all();
  let migrated = 0;
  for (const game of games) {
    if (game.shop === "custom") continue;
    const before = game.installationId;
    await ensureGameInstallation(game);
    if (!before) migrated += 1;
  }
  return migrated;
};
