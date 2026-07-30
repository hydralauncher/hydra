import { createHash } from "node:crypto";

import { cloudSaveCustomPathsSublevel, db, levelKeys } from "@main/level";
import { logger } from "@main/services/logger";
import type {
  CloudSaveCustomPath,
  CloudSaveCustomPathBindings,
  CloudSaveRule,
  GameShop,
  User,
} from "@types";

import {
  cloudSaveCustomPathStorageKey,
  getCurrentCloudSaveCustomPathContext,
} from "./custom-path";
import {
  applyCloudSaveCustomPathLocalPathMigrations,
  type StoredCloudSaveCustomPath,
} from "./custom-path-binding-state";
import { resolveStoredCloudSaveCustomPathBindings } from "./custom-path-binding-resolver";
import { CloudSaveOperationCoordinator } from "./operation-coordinator";

const storeMutationCoordinator = new CloudSaveOperationCoordinator<void>();
let storeMutationId = 0;

const getCurrentUserId = async () => {
  const user = await db.get<string, User>(levelKeys.user, {
    valueEncoding: "json",
  });
  if (!user?.id) throw new Error("Cloud save custom paths require a user");
  return user.id;
};

const getStorageKey = async (shop: GameShop, objectId: string) =>
  cloudSaveCustomPathStorageKey(await getCurrentUserId(), shop, objectId);

const isStoredPath = (value: unknown): value is StoredCloudSaveCustomPath => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.rawPath === "string" &&
    (record.storeUserId === undefined ||
      typeof record.storeUserId === "string") &&
    (record.localPath === undefined || typeof record.localPath === "string") &&
    Object.keys(record).every(
      (key) => key === "rawPath" || key === "storeUserId" || key === "localPath"
    )
  );
};

const normalizeStoredEntries = (
  value: unknown
): StoredCloudSaveCustomPath[] => {
  if (!Array.isArray(value)) return [];
  const entries = value
    .filter(isStoredPath)
    .filter(({ rawPath }) => rawPath.startsWith("<custom>"));

  const byRawPath = new Map<string, StoredCloudSaveCustomPath>();
  for (const entry of entries) {
    const existing = byRawPath.get(entry.rawPath);
    byRawPath.set(entry.rawPath, {
      rawPath: entry.rawPath,
      storeUserId: entry.storeUserId ?? existing?.storeUserId,
      localPath: entry.localPath ?? existing?.localPath,
    });
  }
  return [...byRawPath.values()].sort((left, right) =>
    left.rawPath.localeCompare(right.rawPath)
  );
};

const getStoredEntriesByKey = async (key: string) =>
  normalizeStoredEntries((await cloudSaveCustomPathsSublevel.get(key)) ?? []);

const getStoredEntries = async (shop: GameShop, objectId: string) =>
  getStoredEntriesByKey(await getStorageKey(shop, objectId));

const putStoredEntriesByKey = async (
  key: string,
  entries: StoredCloudSaveCustomPath[]
) => {
  const normalized = normalizeStoredEntries(entries);
  if (normalized.length === 0) {
    await cloudSaveCustomPathsSublevel.del(key).catch(() => undefined);
  } else {
    await cloudSaveCustomPathsSublevel.put(key, normalized);
  }
};

const mutateStoredEntriesByKey = (
  key: string,
  mutation: (
    entries: StoredCloudSaveCustomPath[]
  ) => StoredCloudSaveCustomPath[]
) =>
  storeMutationCoordinator.run(
    key,
    `custom-path-store:${++storeMutationId}`,
    async () => {
      const entries = await getStoredEntriesByKey(key);
      await putStoredEntriesByKey(key, mutation(entries));
    }
  );

const mutateStoredEntries = async (
  shop: GameShop,
  objectId: string,
  mutation: (
    entries: StoredCloudSaveCustomPath[]
  ) => StoredCloudSaveCustomPath[]
) => mutateStoredEntriesByKey(await getStorageKey(shop, objectId), mutation);

export const getCloudSaveCustomPathBindings = async (
  shop: GameShop,
  objectId: string,
  context = getCurrentCloudSaveCustomPathContext()
): Promise<CloudSaveCustomPathBindings> => {
  const key = await getStorageKey(shop, objectId);
  const entries = await getStoredEntriesByKey(key);
  const { bindings, migrations } = resolveStoredCloudSaveCustomPathBindings(
    entries,
    context
  );

  if (migrations.length > 0) {
    await mutateStoredEntriesByKey(key, (currentEntries) =>
      applyCloudSaveCustomPathLocalPathMigrations(currentEntries, migrations)
    ).catch((error: unknown) => {
      logger.warn("[Cloud Save] Failed to migrate custom path bindings", {
        shop,
        objectId,
        error,
      });
    });
  }

  return bindings;
};

export const saveCloudSaveCustomPaths = async (
  shop: GameShop,
  objectId: string,
  customPaths: CloudSaveCustomPath[]
) =>
  mutateStoredEntries(shop, objectId, () =>
    customPaths.map((customPath) => ({
      rawPath: customPath.rawPath,
      storeUserId: customPath.storeUserId,
      localPath: customPath.path,
    }))
  );

export const registerCloudSaveCustomPaths = async (
  shop: GameShop,
  objectId: string,
  customPaths: CloudSaveCustomPath[]
) => {
  await mutateStoredEntries(shop, objectId, (entries) => {
    const byRawPath = new Map(entries.map((entry) => [entry.rawPath, entry]));
    for (const { rawPath, storeUserId, path: localPath } of customPaths) {
      const existing = byRawPath.get(rawPath);
      byRawPath.set(rawPath, {
        rawPath,
        storeUserId: storeUserId ?? existing?.storeUserId,
        localPath: localPath ?? existing?.localPath,
      });
    }
    return [...byRawPath.values()];
  });
};

export const isCloudSaveCustomPathRegistered = async (
  shop: GameShop,
  objectId: string,
  rawPath: string
) =>
  (await getStoredEntries(shop, objectId)).some(
    (entry) => entry.rawPath === rawPath
  );

export const unregisterCloudSaveCustomPath = async (
  shop: GameShop,
  objectId: string,
  rawPath: string
) => {
  await mutateStoredEntries(shop, objectId, (entries) => {
    if (!entries.some((entry) => entry.rawPath === rawPath)) {
      throw new Error("cloud_save_custom_path_not_registered");
    }
    return entries.filter((entry) => entry.rawPath !== rawPath);
  });
};

export const customPathToCloudSaveRule = (
  customPath: CloudSaveCustomPath
): CloudSaveRule => ({
  ruleId: `custom-${createHash("sha256")
    .update(customPath.rawPath)
    .digest("hex")}`,
  kind: "dir",
  rawPath: customPath.rawPath,
  source: "custom",
  tags: ["save"],
  when: [{ os: customPath.platform }],
  preferredPath: customPath.path,
});

export const getCloudSaveCustomPathRules = async (
  shop: GameShop,
  objectId: string,
  context = getCurrentCloudSaveCustomPathContext()
) =>
  (await getCloudSaveCustomPathBindings(shop, objectId, context)).ready.map(
    customPathToCloudSaveRule
  );
