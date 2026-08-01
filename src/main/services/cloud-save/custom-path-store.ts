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
  type CloudSaveCustomPathContext,
} from "./custom-path";
import {
  applyCloudSaveCustomPathLocalPathMigrations,
  ignoreStoredCloudSaveCustomPath,
  trackStoredCloudSaveCustomPaths,
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
    (record.tracking === undefined ||
      record.tracking === "tracked" ||
      record.tracking === "ignored") &&
    (record.storeUserId === undefined ||
      typeof record.storeUserId === "string") &&
    (record.localPath === undefined || typeof record.localPath === "string") &&
    Object.keys(record).every(
      (key) =>
        key === "rawPath" ||
        key === "tracking" ||
        key === "storeUserId" ||
        key === "localPath"
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
    if (entry.tracking === "ignored") {
      byRawPath.set(entry.rawPath, {
        rawPath: entry.rawPath,
        tracking: "ignored",
      });
      continue;
    }

    const existing = byRawPath.get(entry.rawPath);
    byRawPath.set(entry.rawPath, {
      rawPath: entry.rawPath,
      tracking: "tracked",
      storeUserId:
        entry.storeUserId ??
        (existing?.tracking !== "ignored" ? existing?.storeUserId : undefined),
      localPath:
        entry.localPath ??
        (existing?.tracking !== "ignored" ? existing?.localPath : undefined),
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
    await cloudSaveCustomPathsSublevel.del(key);
  } else {
    await cloudSaveCustomPathsSublevel.put(key, normalized);
  }
};

const mutateStoredEntriesByKey = (
  key: string,
  mutation: (
    entries: StoredCloudSaveCustomPath[]
  ) => StoredCloudSaveCustomPath[] | Promise<StoredCloudSaveCustomPath[]>
) =>
  storeMutationCoordinator.run(
    key,
    `custom-path-store:${++storeMutationId}`,
    async () => {
      const entries = await getStoredEntriesByKey(key);
      await putStoredEntriesByKey(key, await mutation(entries));
    }
  );

export const withCloudSaveCustomPathStoreMutation = async (
  shop: GameShop,
  objectId: string,
  context: CloudSaveCustomPathContext,
  operation: (
    storageKey: string,
    bindings: CloudSaveCustomPathBindings
  ) => Promise<void>
) => {
  const storageKey = await getStorageKey(shop, objectId);
  return storeMutationCoordinator.run(
    storageKey,
    `custom-path-store:${++storeMutationId}`,
    async () => {
      const entries = await getStoredEntriesByKey(storageKey);
      const { bindings, migrations } = resolveStoredCloudSaveCustomPathBindings(
        entries,
        context
      );
      if (migrations.length > 0) {
        await putStoredEntriesByKey(
          storageKey,
          applyCloudSaveCustomPathLocalPathMigrations(entries, migrations)
        );
      }
      await operation(storageKey, bindings);
    }
  );
};

const mutateStoredEntries = async (
  shop: GameShop,
  objectId: string,
  mutation: (
    entries: StoredCloudSaveCustomPath[]
  ) => StoredCloudSaveCustomPath[] | Promise<StoredCloudSaveCustomPath[]>
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

export const getCloudSaveCustomPathTrackingState = async (
  shop: GameShop,
  objectId: string,
  context = getCurrentCloudSaveCustomPathContext()
) => {
  const entries = await getStoredEntries(shop, objectId);
  const trackedEntries = entries.filter(
    (entry) => entry.tracking !== "ignored"
  );
  const { bindings, migrations } = resolveStoredCloudSaveCustomPathBindings(
    trackedEntries,
    context
  );

  if (migrations.length > 0) {
    await mutateStoredEntries(shop, objectId, (currentEntries) =>
      applyCloudSaveCustomPathLocalPathMigrations(currentEntries, migrations)
    ).catch((error: unknown) => {
      logger.warn("[Cloud Save] Failed to migrate custom path bindings", {
        shop,
        objectId,
        error,
      });
    });
  }

  return {
    bindings,
    ignoredRawPaths: entries
      .filter((entry) => entry.tracking === "ignored")
      .map((entry) => entry.rawPath),
  };
};

export const saveCloudSaveCustomPaths = async (
  shop: GameShop,
  objectId: string,
  customPaths: CloudSaveCustomPath[]
) =>
  mutateStoredEntries(shop, objectId, (entries) =>
    entries
      .filter((entry) => entry.tracking === "ignored")
      .filter(
        (entry) =>
          !customPaths.some(
            (customPath) => customPath.rawPath === entry.rawPath
          )
      )
      .concat(
        customPaths.map((customPath) => ({
          rawPath: customPath.rawPath,
          tracking: "tracked" as const,
          storeUserId: customPath.storeUserId,
          localPath: customPath.path,
        }))
      )
  );

export const registerCloudSaveCustomPaths = async (
  shop: GameShop,
  objectId: string,
  customPaths: CloudSaveCustomPath[],
  options: {
    context?: CloudSaveCustomPathContext;
    assertCurrentBindings?: (
      bindings: CloudSaveCustomPathBindings
    ) => void | Promise<void>;
  } = {}
) => {
  await mutateStoredEntries(shop, objectId, async (entries) => {
    if (options.assertCurrentBindings) {
      const { bindings } = resolveStoredCloudSaveCustomPathBindings(
        entries,
        options.context ?? getCurrentCloudSaveCustomPathContext()
      );
      await options.assertCurrentBindings(bindings);
    }
    return trackStoredCloudSaveCustomPaths(
      entries,
      customPaths.map(({ rawPath, storeUserId, path: localPath }) => ({
        rawPath,
        storeUserId,
        localPath,
      }))
    );
  });
};

export const isCloudSaveCustomPathRegistered = async (
  shop: GameShop,
  objectId: string,
  rawPath: string
) =>
  (await getStoredEntries(shop, objectId)).some(
    (entry) => entry.rawPath === rawPath && entry.tracking !== "ignored"
  );

export const ignoreCloudSaveCustomPath = async (
  shop: GameShop,
  objectId: string,
  rawPath: string
) => {
  await mutateStoredEntries(shop, objectId, (entries) =>
    ignoreStoredCloudSaveCustomPath(entries, rawPath)
  );
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
