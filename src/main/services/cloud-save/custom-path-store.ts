import { createHash } from "node:crypto";

import { cloudSaveCustomPathsSublevel, db, levelKeys } from "@main/level";
import type {
  CloudSaveCustomPath,
  CloudSaveRule,
  GameShop,
  User,
} from "@types";

import {
  cloudSaveCustomPathStorageKey,
  decodeCloudSaveCustomPath,
  getCurrentCloudSaveCustomPathPlatform,
  tryDecodeCloudSaveCustomPath,
} from "./custom-path";

const getCurrentUserId = async () => {
  const user = await db.get<string, User>(levelKeys.user, {
    valueEncoding: "json",
  });
  if (!user?.id) throw new Error("Cloud save custom paths require a user");
  return user.id;
};

const getStorageKey = async (shop: GameShop, objectId: string) =>
  cloudSaveCustomPathStorageKey(await getCurrentUserId(), shop, objectId);

const normalizeStoredPaths = (rawPaths: unknown): string[] => {
  if (!Array.isArray(rawPaths)) return [];
  const platform = getCurrentCloudSaveCustomPathPlatform();
  return [
    ...new Set(
      rawPaths.filter(
        (rawPath): rawPath is string =>
          typeof rawPath === "string" &&
          tryDecodeCloudSaveCustomPath(rawPath)?.platform === platform
      )
    ),
  ].sort();
};

export const getCloudSaveCustomPaths = async (
  shop: GameShop,
  objectId: string
): Promise<CloudSaveCustomPath[]> => {
  const stored =
    (await cloudSaveCustomPathsSublevel.get(
      await getStorageKey(shop, objectId)
    )) ?? [];
  return normalizeStoredPaths(stored).map(decodeCloudSaveCustomPath);
};

export const saveCloudSaveCustomPaths = async (
  shop: GameShop,
  objectId: string,
  rawPaths: string[]
) => {
  const key = await getStorageKey(shop, objectId);
  const normalized = normalizeStoredPaths(rawPaths);
  if (normalized.length === 0) {
    await cloudSaveCustomPathsSublevel.del(key).catch(() => undefined);
  } else {
    await cloudSaveCustomPathsSublevel.put(key, normalized);
  }
};

export const registerCloudSaveCustomPaths = async (
  shop: GameShop,
  objectId: string,
  customPaths: CloudSaveCustomPath[]
) => {
  const existing = await getCloudSaveCustomPaths(shop, objectId);
  await saveCloudSaveCustomPaths(shop, objectId, [
    ...existing.map(({ rawPath }) => rawPath),
    ...customPaths.map(({ rawPath }) => rawPath),
  ]);
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
});

export const getCloudSaveCustomPathRules = async (
  shop: GameShop,
  objectId: string
) =>
  (await getCloudSaveCustomPaths(shop, objectId)).map(
    customPathToCloudSaveRule
  );
