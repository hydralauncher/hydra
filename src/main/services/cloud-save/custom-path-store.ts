import { createHash } from "node:crypto";

import { cloudSaveCustomPathsSublevel, db, levelKeys } from "@main/level";
import type {
  CloudSaveCustomPath,
  CloudSaveRule,
  GameShop,
  User,
} from "@types";

import {
  bindCloudSaveCustomPathToLocalPath,
  type CloudSaveCustomPathContext,
  cloudSaveCustomPathStorageKey,
  decodeCloudSaveCustomPath,
  getCurrentCloudSaveCustomPathContext,
} from "./custom-path";

interface StoredCloudSaveCustomPath {
  rawPath: string;
  storeUserId?: string;
  localPath?: string;
}

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

const decodeStoredPath = (
  stored: StoredCloudSaveCustomPath,
  context: CloudSaveCustomPathContext
) => {
  if (
    !stored.localPath &&
    stored.rawPath.includes("<storeUserId>") &&
    !stored.storeUserId &&
    (context.storeUserIds?.length ?? 0) !== 1
  ) {
    throw new Error("cloud_save_custom_path_store_user_ambiguous");
  }
  const bindingContext = {
    ...context,
    preferredStoreUserId:
      stored.storeUserId ??
      (stored.rawPath.includes("<storeUserId>")
        ? context.storeUserIds?.[0]
        : undefined),
  };
  return stored.localPath
    ? bindCloudSaveCustomPathToLocalPath(
        stored.rawPath,
        stored.localPath,
        bindingContext
      )
    : decodeCloudSaveCustomPath(stored.rawPath, bindingContext);
};

const getStoredEntries = async (shop: GameShop, objectId: string) =>
  normalizeStoredEntries(
    (await cloudSaveCustomPathsSublevel.get(
      await getStorageKey(shop, objectId)
    )) ?? []
  );

const putStoredEntries = async (
  shop: GameShop,
  objectId: string,
  entries: StoredCloudSaveCustomPath[]
) => {
  const key = await getStorageKey(shop, objectId);
  const normalized = normalizeStoredEntries(entries);
  if (normalized.length === 0) {
    await cloudSaveCustomPathsSublevel.del(key).catch(() => undefined);
  } else {
    await cloudSaveCustomPathsSublevel.put(key, normalized);
  }
};

export const getCloudSaveCustomPaths = async (
  shop: GameShop,
  objectId: string,
  context = getCurrentCloudSaveCustomPathContext()
): Promise<CloudSaveCustomPath[]> => {
  const customPaths: CloudSaveCustomPath[] = [];
  for (const stored of await getStoredEntries(shop, objectId)) {
    try {
      customPaths.push({
        ...decodeStoredPath(stored, context),
        ...(stored.storeUserId ? { storeUserId: stored.storeUserId } : {}),
      });
    } catch {
      // Keep unavailable bindings in storage. A missing active Wine profile
      // or store account must not make another registration erase them.
    }
  }
  return customPaths;
};

export const getUnavailableCloudSaveCustomPathRawPaths = async (
  shop: GameShop,
  objectId: string,
  context = getCurrentCloudSaveCustomPathContext()
) => {
  const unavailable: string[] = [];
  for (const stored of await getStoredEntries(shop, objectId)) {
    try {
      decodeStoredPath(stored, context);
    } catch {
      unavailable.push(stored.rawPath);
    }
  }
  return unavailable;
};

export const saveCloudSaveCustomPaths = async (
  shop: GameShop,
  objectId: string,
  customPaths: CloudSaveCustomPath[]
) =>
  putStoredEntries(
    shop,
    objectId,
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
  const byRawPath = new Map(
    (await getStoredEntries(shop, objectId)).map((entry) => [
      entry.rawPath,
      entry,
    ])
  );
  for (const { rawPath, storeUserId, path: localPath } of customPaths) {
    const existing = byRawPath.get(rawPath);
    byRawPath.set(rawPath, {
      rawPath,
      storeUserId: storeUserId ?? existing?.storeUserId,
      localPath: localPath ?? existing?.localPath,
    });
  }
  await putStoredEntries(shop, objectId, [...byRawPath.values()]);
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
  const entries = await getStoredEntries(shop, objectId);
  if (!entries.some((entry) => entry.rawPath === rawPath)) {
    throw new Error("cloud_save_custom_path_not_registered");
  }

  await putStoredEntries(
    shop,
    objectId,
    entries.filter((entry) => entry.rawPath !== rawPath)
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
  (await getCloudSaveCustomPaths(shop, objectId, context)).map(
    customPathToCloudSaveRule
  );
