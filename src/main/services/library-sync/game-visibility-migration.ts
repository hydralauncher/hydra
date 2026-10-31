import { db, gamesSublevel, levelKeys } from "@main/level";

import {
  migrateGameVisibilityWithStore,
  type GameVisibilityMigrationStore,
} from "./game-visibility-migration-policy";

const migrationSublevel = db.sublevel<string, boolean>(
  levelKeys.gameVisibilityRenameMigration,
  { valueEncoding: "json" }
);
const migrationCompletedKey = "completed";

const store: GameVisibilityMigrationStore = {
  getCompleted: async () =>
    (await migrationSublevel.get(migrationCompletedKey)) === true,
  getGames: () => gamesSublevel.iterator().all(),
  commit: async (games) => {
    const batch = db.batch();
    for (const [key, game] of games) {
      batch.put(key, game, { sublevel: gamesSublevel });
    }
    batch.put(migrationCompletedKey, true, { sublevel: migrationSublevel });
    await batch.write();
  },
};

export const migrateGameVisibilityFields = async () =>
  migrateGameVisibilityWithStore(store);
