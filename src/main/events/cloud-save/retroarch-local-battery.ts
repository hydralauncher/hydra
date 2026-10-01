import { gamesSublevel, levelKeys } from "@main/level";
import { isGameRunning } from "@main/services/process-watcher";
import {
  listRetroArchLocalBatteryCandidates,
  selectRetroArchLocalBattery,
} from "@main/services/cloud-save/retroarch-save-provider";
import { getEmulatorSaveProvider } from "@main/services/cloud-save/emulator-save-provider";
import { parseRetroArchSaveRawPath } from "@main/services/cloud-save/emulator-provider-identity";
import { listRemoteGameSnapshots } from "@main/services/cloud-save/list-remote-game-snapshots";
import { getRemoteSnapshotRestoreManifest } from "@main/services/cloud-save/resolve-remote-snapshot-targets";
import { isRetroArchBatteryRelativePath } from "@main/services/cloud-save/retroarch-snapshot-migration";
import {
  loadRetroArchBindings,
  saveRetroArchBindings,
} from "@main/services/cloud-save/retroarch-state-bindings";
import type { GameShop } from "@types";

import { registerEvent } from "../register-event";

const retroArchGame = async (objectId: string, shop: GameShop) => {
  const game = await gamesSublevel.get(levelKeys.game(shop, objectId));
  if (!game || getEmulatorSaveProvider(game) !== "retroarch") {
    throw new Error("cloud_save_retroarch_game_required");
  }
  return game;
};

registerEvent(
  "getRetroArchLocalBatteryCandidates",
  async (
    _event: Electron.IpcMainInvokeEvent,
    objectId: string,
    shop: GameShop
  ) => listRetroArchLocalBatteryCandidates(await retroArchGame(objectId, shop))
);

registerEvent(
  "selectRetroArchLocalBattery",
  async (
    _event: Electron.IpcMainInvokeEvent,
    objectId: string,
    shop: GameShop,
    romPath: string,
    signature: string
  ) => {
    if (isGameRunning(objectId, shop)) {
      throw new Error("cloud_save_game_running");
    }
    await selectRetroArchLocalBattery(
      await retroArchGame(objectId, shop),
      romPath,
      signature
    );
  }
);

const legacyBatteryCandidates = async (objectId: string, shop: GameShop) => {
  await retroArchGame(objectId, shop);
  const snapshots = await listRemoteGameSnapshots(objectId, shop);
  const manifest = snapshots[0]
    ? await getRemoteSnapshotRestoreManifest(snapshots[0])
    : null;
  const grouped = new Map<
    string,
    Array<{
      relativePath: string;
      hash: string;
      lastModifiedAt: string;
    }>
  >();
  for (const file of manifest?.files ?? []) {
    if (
      !parseRetroArchSaveRawPath(file.rawPath) ||
      !isRetroArchBatteryRelativePath(file.relativePath)
    )
      continue;
    const files = grouped.get(file.rawPath) ?? [];
    files.push({
      relativePath: file.relativePath,
      hash: file.hash,
      lastModifiedAt: file.lastModifiedAt,
    });
    grouped.set(file.rawPath, files);
  }
  return [...grouped].map(([rawPath, files]) => ({ rawPath, files }));
};

registerEvent(
  "getRetroArchLegacyBatteryCandidates",
  (_event: Electron.IpcMainInvokeEvent, objectId: string, shop: GameShop) =>
    legacyBatteryCandidates(objectId, shop)
);

registerEvent(
  "selectRetroArchLegacyBattery",
  async (
    _event: Electron.IpcMainInvokeEvent,
    objectId: string,
    shop: GameShop,
    rawPath: string
  ) => {
    if (isGameRunning(objectId, shop)) {
      throw new Error("cloud_save_game_running");
    }
    if (
      !(await legacyBatteryCandidates(objectId, shop)).some(
        (item) => item.rawPath === rawPath
      )
    )
      throw new Error("cloud_save_retroarch_battery_selection_stale");
    const game = await retroArchGame(objectId, shop);
    const bindings = await loadRetroArchBindings(game);
    await saveRetroArchBindings(game, {
      ...bindings,
      selectedLegacyBatteryRawPath: rawPath,
    });
  }
);
