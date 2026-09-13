import {
  db,
  localSouvenirAssetsSublevel,
  pendingGroupedAchievementSouvenirsSublevel,
} from "@main/level";
import type { LocalSouvenirAsset, PendingAchievementSouvenir } from "@types";

export const PendingGroupedSouvenirStore = {
  get: (clientId: string) =>
    pendingGroupedAchievementSouvenirsSublevel.get(clientId),

  put: (souvenir: PendingAchievementSouvenir) =>
    pendingGroupedAchievementSouvenirsSublevel.put(souvenir.clientId, souvenir),

  delete: (clientId: string) =>
    pendingGroupedAchievementSouvenirsSublevel.del(clientId),

  async replaceClientId(
    previousClientId: string,
    souvenir: PendingAchievementSouvenir
  ) {
    const batch = db.batch();
    batch.del(previousClientId, {
      sublevel: pendingGroupedAchievementSouvenirsSublevel,
    });
    batch.put(souvenir.clientId, souvenir, {
      sublevel: pendingGroupedAchievementSouvenirsSublevel,
    });
    await batch.write();
  },

  list: () => pendingGroupedAchievementSouvenirsSublevel.values().all(),

  async getProtectedScreenshotPaths() {
    const pending = await pendingGroupedAchievementSouvenirsSublevel
      .values()
      .all();
    return new Set(pending.map((souvenir) => souvenir.screenshotPath));
  },

  async acknowledge(pending: PendingAchievementSouvenir, souvenirId: string) {
    const asset: LocalSouvenirAsset = {
      souvenirId,
      clientId: pending.clientId,
      ownerId: pending.ownerId,
      gameKey: pending.gameKey,
      screenshotPath: pending.screenshotPath,
    };
    const batch = db.batch();
    batch.put(souvenirId, asset, { sublevel: localSouvenirAssetsSublevel });
    batch.del(pending.clientId, {
      sublevel: pendingGroupedAchievementSouvenirsSublevel,
    });
    await batch.write();
  },
};

export const LocalSouvenirAssetStore = {
  get: (souvenirId: string) => localSouvenirAssetsSublevel.get(souvenirId),

  delete: (souvenirId: string) => localSouvenirAssetsSublevel.del(souvenirId),

  list: () => localSouvenirAssetsSublevel.values().all(),

  async deleteByScreenshotPaths(paths: ReadonlySet<string>) {
    if (!paths.size) return;

    const assets = await localSouvenirAssetsSublevel.values().all();
    const batch = db.batch();
    let hasChanges = false;

    for (const asset of assets) {
      if (!paths.has(asset.screenshotPath)) continue;
      batch.del(asset.souvenirId, { sublevel: localSouvenirAssetsSublevel });
      hasChanges = true;
    }

    if (hasChanges) await batch.write();
  },
};
