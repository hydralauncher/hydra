import type { Game } from "@types";
import {
  getCloudSaveEmulatorProvider,
  type CloudSaveEmulatorProvider,
} from "../../../shared/cloud-save-emulator-provider.js";

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
  store: EmulatorCloudSaveMigrationStore,
  providers: readonly CloudSaveEmulatorProvider[] = ["rpcs3", "retroarch"]
) => {
  if (await store.getCompleted()) return false;

  const [games, storedSettings] = await Promise.all([
    store.getGames(),
    store.getStoredSettings(),
  ]);
  const eligibleGames = games.filter(([, game]) =>
    providers.some(
      (provider) =>
        provider === getCloudSaveEmulatorProvider(game.shop, game.platform)
    )
  );
  const eligibleKeys = new Set(eligibleGames.map(([key]) => key));
  const gamesToDisableLegacy = eligibleGames.filter(
    ([, game]) => game.automaticCloudSync === true
  );
  const settingKeysToDelete = storedSettings
    .map(([key]) => key)
    .filter((key) => eligibleKeys.has(key));

  await store.commit(gamesToDisableLegacy, settingKeysToDelete);
  return true;
};
