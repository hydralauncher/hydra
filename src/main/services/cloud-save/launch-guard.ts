import type { GameShop, SyncGameCloudSaveResult } from "@types";

export interface CloudSaveLaunchGuard {
  environmentId: string;
  baseRemoteHash: string | null;
  uploadAllowed: boolean;
  createdAt: string;
}

const guards = new Map<string, CloudSaveLaunchGuard>();

const getKey = (objectId: string, shop: GameShop) =>
  JSON.stringify([shop, objectId]);

export const setCloudSaveLaunchGuard = (
  objectId: string,
  shop: GameShop,
  guard: CloudSaveLaunchGuard
) => guards.set(getKey(objectId, shop), guard);

export const consumeCloudSaveLaunchGuard = (
  objectId: string,
  shop: GameShop
) => {
  const key = getKey(objectId, shop);
  const guard = guards.get(key) ?? null;
  guards.delete(key);
  return guard;
};

export const clearCloudSaveLaunchGuard = (objectId: string, shop: GameShop) =>
  guards.delete(getKey(objectId, shop));

export const canUploadCloudSaveAfterLaunch = (
  guard: CloudSaveLaunchGuard | null,
  currentEnvironmentId: string
) =>
  guard?.uploadAllowed === true && guard.environmentId === currentEnvironmentId;

export const canCreateCloudSaveUploadGuard = (
  preparationSafe: boolean,
  environmentId: string,
  preLaunchResult: SyncGameCloudSaveResult | null
) =>
  preparationSafe &&
  preLaunchResult !== null &&
  preLaunchResult.trigger === "pre-launch" &&
  preLaunchResult.environmentId === environmentId &&
  preLaunchResult.action !== "conflict";

export const shouldBlockGameLaunchForCloudSave = (
  preLaunchResult: SyncGameCloudSaveResult | null
) =>
  preLaunchResult?.trigger === "pre-launch" &&
  preLaunchResult.action === "conflict";
