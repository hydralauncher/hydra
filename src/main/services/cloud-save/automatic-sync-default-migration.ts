import {
  cloudSaveAutomaticSyncSettingsSublevel,
  db,
  gamesSublevel,
  levelKeys,
} from "@main/level";

import {
  migrateCloudSaveAutomaticSyncDefaultsWithStore,
  type CloudSaveAutomaticSyncDefaultMigrationStore,
} from "./automatic-sync-default-migration-policy";

const migrationSublevel = db.sublevel<string, boolean>(
  levelKeys.cloudSaveV2DefaultMigration,
  { valueEncoding: "json" }
);
const migrationCompletedKey = "completed";

const defaultStore: CloudSaveAutomaticSyncDefaultMigrationStore = {
  getCompleted: async () =>
    (await migrationSublevel.get(migrationCompletedKey)) === true,
  getGames: () => gamesSublevel.iterator().all(),
  getStoredSettings: () =>
    cloudSaveAutomaticSyncSettingsSublevel.iterator().all(),
  commit: async (gamesToDisableLegacy, settingKeysToDelete) => {
    const batch = db.batch();

    for (const [key, game] of gamesToDisableLegacy) {
      batch.put(
        key,
        { ...game, automaticCloudSync: false },
        { sublevel: gamesSublevel }
      );
    }

    for (const key of settingKeysToDelete) {
      batch.del(key, { sublevel: cloudSaveAutomaticSyncSettingsSublevel });
    }

    batch.put(migrationCompletedKey, true, { sublevel: migrationSublevel });
    await batch.write();
  },
};

export const migrateCloudSaveAutomaticSyncDefaults = async () =>
  migrateCloudSaveAutomaticSyncDefaultsWithStore(defaultStore);
