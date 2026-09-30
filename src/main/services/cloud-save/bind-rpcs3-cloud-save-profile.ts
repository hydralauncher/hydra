import { promises as fs } from "node:fs";
import path from "node:path";

import { gamesSublevel, levelKeys } from "@main/level";
import type { GameShop } from "@types";

import { isGameRunning } from "../game-running-state";
import { assertCloudSaveSubscription } from "./cloud-save-access";
import { getEmulatorSaveProvider } from "./emulator-save-provider";
import { listRemoteGameSnapshots } from "./list-remote-game-snapshots";
import {
  cloudSaveOperationGate,
  cloudSaveOperationScopeKey,
} from "./operation-gate";
import { getRemoteSnapshotRestoreManifest } from "./resolve-remote-snapshot-targets";
import { listRpcs3CloudProfileIds } from "./rpcs3-profile-binding-policy";
import { setRpcs3ProfileBinding } from "./rpcs3-profile-binding-store";

export const bindRpcs3CloudSaveProfile = async (
  objectId: string,
  shop: GameShop,
  cloudProfileId: string
) => {
  assertCloudSaveSubscription();
  return cloudSaveOperationGate.runSync(
    cloudSaveOperationScopeKey(objectId, shop),
    "bind-rpcs3-profile",
    async () => {
      if (isGameRunning(objectId, shop)) {
        throw new Error("cloud_save_game_running");
      }
      const game = await gamesSublevel.get(levelKeys.game(shop, objectId));
      if (!game || getEmulatorSaveProvider(game) !== "rpcs3") {
        throw new Error("cloud_save_rpcs3_profile_binding_unavailable");
      }
      const { resolveRpcs3ActiveSaveLocation } = await import(
        "./rpcs3-save-provider"
      );
      const { configRoot, homeRoot, activeProfileId } =
        await resolveRpcs3ActiveSaveLocation();
      const activeProfile = await fs
        .lstat(path.join(homeRoot, activeProfileId))
        .catch(() => null);
      if (!activeProfile?.isDirectory() || activeProfile.isSymbolicLink()) {
        throw new Error("cloud_save_rpcs3_active_profile_unavailable");
      }

      const snapshots = await listRemoteGameSnapshots(objectId, shop);
      const manifest = snapshots[0]
        ? await getRemoteSnapshotRestoreManifest(snapshots[0])
        : null;
      const cloudProfiles = listRpcs3CloudProfileIds(manifest?.files ?? []);
      if (
        cloudProfiles.length > 0
          ? !cloudProfiles.includes(cloudProfileId)
          : cloudProfileId !== activeProfileId
      ) {
        throw new Error("cloud_save_rpcs3_cloud_profile_unavailable");
      }

      await setRpcs3ProfileBinding(shop, objectId, {
        configRoot,
        homeRoot,
        localProfileId: activeProfileId,
        cloudProfileId,
      });
    }
  );
};
