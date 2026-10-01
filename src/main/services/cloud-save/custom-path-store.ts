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
  confirmStoredCloudSaveCustomPaths,
  normalizeStoredCloudSaveCustomPathEntries,
  reconcileStoredCloudSaveCustomPaths,
  removeStoredCloudSaveCustomPath,
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

const getStoredEntriesByKey = async (key: string) =>
  normalizeStoredCloudSaveCustomPathEntries(
    (await cloudSaveCustomPathsSublevel.get(key)) ?? []
  );

const getStoredEntries = async (shop: GameShop, objectId: string) =>
  getStoredEntriesByKey(await getStorageKey(shop, objectId));

const putStoredEntriesByKey = async (
  key: string,
  entries: StoredCloudSaveCustomPath[]
) => {
  const normalized = normalizeStoredCloudSaveCustomPathEntries(entries);
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
    bindings: CloudSaveCustomPathBindings,
    mutations: {
      remove: (rawPath: string) => Promise<void>;
    }
  ) => Promise<void>
) => {
  const storageKey = await getStorageKey(shop, objectId);
  return storeMutationCoordinator.run(
    storageKey,
    `custom-path-store:${++storeMutationId}`,
    async () => {
      let entries = await getStoredEntriesByKey(storageKey);
      const { bindings, migrations } = resolveStoredCloudSaveCustomPathBindings(
        entries,
        context
      );
      if (migrations.length > 0) {
        entries = applyCloudSaveCustomPathLocalPathMigrations(
          entries,
          migrations
        );
        await putStoredEntriesByKey(storageKey, entries);
      }
      return operation(storageKey, bindings, {
        remove: async (rawPath) => {
          entries = removeStoredCloudSaveCustomPath(entries, rawPath);
          await putStoredEntriesByKey(storageKey, entries);
        },
      });
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
  const { bindings, migrations } = resolveStoredCloudSaveCustomPathBindings(
    entries,
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
    pendingRawPaths: entries
      .filter((entry) => entry.syncState === "pending")
      .map((entry) => entry.rawPath),
  };
};

export const reconcileCloudSaveCustomPathsWithRemote = async (
  shop: GameShop,
  objectId: string,
  remoteRawPaths: string[],
  context = getCurrentCloudSaveCustomPathContext()
) => {
  const key = await getStorageKey(shop, objectId);
  const remote = new Set(remoteRawPaths);
  let result: ReturnType<typeof resolveStoredCloudSaveCustomPathBindings>;
  await storeMutationCoordinator.run(
    key,
    `custom-path-store:${++storeMutationId}`,
    async () => {
      const entries = await getStoredEntriesByKey(key);
      const reconciled = reconcileStoredCloudSaveCustomPaths(entries, remote);
      result = resolveStoredCloudSaveCustomPathBindings(reconciled, context);
      await putStoredEntriesByKey(
        key,
        applyCloudSaveCustomPathLocalPathMigrations(
          reconciled,
          result.migrations
        )
      );
    }
  );
  return {
    bindings: result!.bindings,
    pendingRawPaths: result!.bindings.ready
      .map(({ rawPath }) => rawPath)
      .filter((rawPath) => !remote.has(rawPath)),
  };
};

export const saveCloudSaveCustomPaths = async (
  shop: GameShop,
  objectId: string,
  customPaths: CloudSaveCustomPath[]
) =>
  mutateStoredEntries(shop, objectId, (entries) =>
    customPaths.map((customPath) => ({
      rawPath: customPath.rawPath,
      syncState:
        entries.find((entry) => entry.rawPath === customPath.rawPath)
          ?.syncState ?? ("confirmed" as const),
      storeUserId: customPath.storeUserId,
      localPath: customPath.path,
    }))
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
    syncState?: StoredCloudSaveCustomPath["syncState"];
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
      })),
      options.syncState
    );
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

export const removeCloudSaveCustomPathBinding = async (
  shop: GameShop,
  objectId: string,
  rawPath: string
) => {
  await mutateStoredEntries(shop, objectId, (entries) =>
    removeStoredCloudSaveCustomPath(entries, rawPath)
  );
};

export const confirmCloudSaveCustomPaths = async (
  shop: GameShop,
  objectId: string,
  remoteRawPaths: string[]
) => {
  const remote = new Set(remoteRawPaths);
  await mutateStoredEntries(shop, objectId, (entries) =>
    confirmStoredCloudSaveCustomPaths(entries, remote)
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
