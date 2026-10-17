import type { Game } from "@types";
import { getCloudSaveEmulatorProvider } from "../../../shared/cloud-save-emulator-provider.js";

export interface EmulatorCloudSaveMigrationStore {
  getCompleted: () => Promise<boolean>;
  getGames: () => Promise<[string, Game][]>;
  getStoredSettings: () => Promise<[string, boolean][]>;
  commit: (
    gamesToDisableLegacy: [string, Game][],
    settingKeysToDelete: string[]
  ) => Promise<void>;
}

export const migrateEmulatorCloudSaveDefaultsWithStore = async (
  store: EmulatorCloudSaveMigrationStore
) => {
  if (await store.getCompleted()) return false;

  const [games, storedSettings] = await Promise.all([
    store.getGames(),
    store.getStoredSettings(),
  ]);
  const eligibleGames = games.filter(
    ([, game]) =>
      getCloudSaveEmulatorProvider(game.shop, game.platform) !== null
  );
  const eligibleKeys = new Set(eligibleGames.map(([key]) => key));
  const gamesToDisableLegacy = eligibleGames.filter(
    ([, game]) => game.automaticCloudSync === true
  );
  const settingKeysToDelete = storedSettings
    .filter(([key, enabled]) => eligibleKeys.has(key) && enabled === true)
    .map(([key]) => key);

  await store.commit(gamesToDisableLegacy, settingKeysToDelete);
  return true;
};
