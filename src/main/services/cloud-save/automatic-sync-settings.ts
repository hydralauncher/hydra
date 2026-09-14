import {
  cloudSaveAutomaticSyncSettingsSublevel,
  db,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import type {
  CloudSaveAutomaticSyncMode,
  CloudSaveAutomaticSyncModeChangedEvent,
  GameShop,
} from "@types";

import { WindowManager } from "../window-manager";
import { assertCloudSaveSubscription } from "./cloud-save-access";
import {
  getCloudSaveAutomaticSyncStateForMode,
  getNextCloudSaveAutomaticSyncMode,
  resolveStoredCloudSaveAutomaticSyncModeForShop,
} from "./automatic-sync-mode";

const getAutomaticSyncKey = (shop: GameShop, objectId: string) =>
  levelKeys.game(shop, objectId);

const notifyAutomaticSyncModeChanged = (
  objectId: string,
  shop: GameShop,
  mode: CloudSaveAutomaticSyncMode
) => {
  const event: CloudSaveAutomaticSyncModeChangedEvent = {
    gameId: { objectId, shop },
    mode,
  };

  WindowManager.sendToAppWindows(
    "on-cloud-save-automatic-sync-mode-changed",
    event
  );
  WindowManager.sendToAppWindows("on-library-batch-complete");
};

const readCloudSaveAutomaticSyncMode = async (
  objectId: string,
  shop: GameShop
) => {
  const key = getAutomaticSyncKey(shop, objectId);
  const [storedV2Enabled, game] = await Promise.all([
    cloudSaveAutomaticSyncSettingsSublevel.get(key),
    gamesSublevel.get(key),
  ]);
  const legacyEnabled = game?.automaticCloudSync === true;
  const mode = resolveStoredCloudSaveAutomaticSyncModeForShop(
    shop,
    legacyEnabled,
    storedV2Enabled
  );

  return { game, key, mode };
};

const persistCloudSaveAutomaticSyncMode = async (
  objectId: string,
  shop: GameShop,
  mode: CloudSaveAutomaticSyncMode
) => {
  const key = getAutomaticSyncKey(shop, objectId);
  const game = await gamesSublevel.get(key);
  const state = getCloudSaveAutomaticSyncStateForMode(mode);
  const batch = db.batch();

  if (game && game.automaticCloudSync !== state.legacyEnabled) {
    batch.put(
      key,
      {
        ...game,
        automaticCloudSync: state.legacyEnabled,
      },
      { sublevel: gamesSublevel }
    );
  }

  batch.put(key, state.v2Enabled, {
    sublevel: cloudSaveAutomaticSyncSettingsSublevel,
  });

  await batch.write();
  notifyAutomaticSyncModeChanged(objectId, shop, mode);
};

export const getCloudSaveAutomaticSyncMode = async (
  objectId: string,
  shop: GameShop
): Promise<CloudSaveAutomaticSyncMode> => {
  return (await readCloudSaveAutomaticSyncMode(objectId, shop)).mode;
};

export const getCloudSaveAutomaticSyncEnabled = async (
  objectId: string,
  shop: GameShop
) => (await getCloudSaveAutomaticSyncMode(objectId, shop)) === "v2";

export const setCloudSaveAutomaticSyncEnabled = async (
  objectId: string,
  shop: GameShop,
  enabled: boolean
) => {
  if (enabled) {
    assertCloudSaveSubscription();
  }

  const { mode: currentMode } = await readCloudSaveAutomaticSyncMode(
    objectId,
    shop
  );
  const nextMode = getNextCloudSaveAutomaticSyncMode(
    currentMode,
    "v2",
    enabled
  );

  await persistCloudSaveAutomaticSyncMode(objectId, shop, nextMode);

  return enabled;
};

export const setLegacyCloudSaveAutomaticSyncEnabled = async (
  objectId: string,
  shop: GameShop,
  enabled: boolean
) => {
  const { mode: currentMode } = await readCloudSaveAutomaticSyncMode(
    objectId,
    shop
  );
  const nextMode = getNextCloudSaveAutomaticSyncMode(
    currentMode,
    "legacy",
    enabled
  );

  await persistCloudSaveAutomaticSyncMode(objectId, shop, nextMode);

  return enabled;
};
