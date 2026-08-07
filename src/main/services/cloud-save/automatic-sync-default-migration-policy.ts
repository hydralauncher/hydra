import type { Game } from "@types";

export interface CloudSaveAutomaticSyncDefaultMigrationStore {
  getCompleted: () => Promise<boolean>;
  getGames: () => Promise<[string, Game][]>;
  getStoredSettings: () => Promise<[string, boolean][]>;
  commit: (
    gamesToDisableLegacy: [string, Game][],
    settingKeysToDelete: string[]
  ) => Promise<void>;
}

const isSteamGameKey = (key: string) => key.startsWith("steam:");

export const migrateCloudSaveAutomaticSyncDefaultsWithStore = async (
  store: CloudSaveAutomaticSyncDefaultMigrationStore
) => {
  if (await store.getCompleted()) return false;

  const [games, storedSettings] = await Promise.all([
    store.getGames(),
    store.getStoredSettings(),
  ]);
  const gamesToDisableLegacy = games.filter(
    ([, game]) => game.shop === "steam" && game.automaticCloudSync === true
  );
  const settingKeysToDelete = storedSettings
    .map(([key]) => key)
    .filter(isSteamGameKey);

  await store.commit(gamesToDisableLegacy, settingKeysToDelete);
  return true;
};
