import { HydraApi } from "@main/services/hydra-api";
import { logger } from "@main/services/logger";
import { Wine } from "@main/services/wine";
import type {
  CloudSavePathContext,
  GameShop,
  ResolvedRestoreTarget,
  RestoreManifestResponse,
} from "@types";

import { NativeAddon } from "../native-addon";
import { getCloudSaveGameContext } from "./cloud-save-game-context";

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isGameShop = (value: unknown): value is GameShop =>
  value === "steam" || value === "custom" || value === "launchbox";

const isWinePrefixValid = (winePrefixPath?: string) => {
  if (!winePrefixPath) return false;
  try {
    return Wine.validatePrefix(winePrefixPath);
  } catch {
    return false;
  }
};

const validateManifest = (value: unknown): RestoreManifestResponse => {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid restore manifest response");
  }

  const response = value as Record<string, unknown>;
  const snapshot = response.snapshot as Record<string, unknown> | undefined;
  if (
    !snapshot ||
    !isNonEmptyString(snapshot.id) ||
    !isGameShop(snapshot.shop) ||
    !isNonEmptyString(snapshot.objectId) ||
    !Array.isArray(response.files)
  ) {
    throw new Error("Invalid restore manifest response");
  }

  for (const file of response.files) {
    if (!file || typeof file !== "object") {
      throw new Error("Invalid restore manifest file");
    }
    const item = file as Record<string, unknown>;
    if (
      !isNonEmptyString(item.rawPath) ||
      !isNonEmptyString(item.relativePath) ||
      !isNonEmptyString(item.hash) ||
      typeof item.sizeBytes !== "number" ||
      !Number.isFinite(item.sizeBytes) ||
      item.sizeBytes < 0 ||
      (item.lastModifiedAt !== undefined &&
        item.lastModifiedAt !== null &&
        (!isNonEmptyString(item.lastModifiedAt) ||
          !Number.isFinite(Date.parse(item.lastModifiedAt))))
    ) {
      throw new Error("Invalid restore manifest file");
    }
  }

  return value as RestoreManifestResponse;
};

export const getRemoteSnapshotRestoreManifest = async (
  snapshotId: string
): Promise<RestoreManifestResponse> => {
  const manifest = validateManifest(
    await HydraApi.get<unknown>(
      "/profile/cloud-saves/snapshot-restore-manifest",
      { snapshotId }
    )
  );
  if (manifest.snapshot.id !== snapshotId) {
    throw new Error("Restore manifest snapshot ID does not match request");
  }
  return manifest;
};

export const resolveRestoreManifestTargets = async (
  manifest: RestoreManifestResponse,
  suppliedPathContext?: CloudSavePathContext
): Promise<ResolvedRestoreTarget[]> => {
  const pathContext =
    suppliedPathContext ??
    (
      await getCloudSaveGameContext(
        manifest.snapshot.objectId,
        manifest.snapshot.shop
      )
    ).pathContext;

  const wineProfiles = pathContext.winePrefixPath
    ? Wine.getPrefixUserProfiles(pathContext.winePrefixPath)
    : [];
  const usesWindowsCompatibility =
    pathContext.platform === "linux" &&
    pathContext.executablePath?.toLowerCase().endsWith(".exe") === true;
  const winePrefixIsValid = isWinePrefixValid(pathContext.winePrefixPath);
  logger.info("[Cloud Save] Resolving remote snapshot targets", {
    shop: manifest.snapshot.shop,
    objectId: manifest.snapshot.objectId,
    fileCount: manifest.files.length,
    winePrefixPath: pathContext.winePrefixPath ?? null,
    winePrefixIsValid,
    wineProfiles,
    storeUserId: pathContext.storeUserId ?? null,
  });

  if (usesWindowsCompatibility && !pathContext.winePrefixPath) {
    throw new Error("cloud_save_restore_prefix_unresolved");
  }
  if (usesWindowsCompatibility && !winePrefixIsValid) {
    throw new Error("cloud_save_restore_prefix_invalid");
  }
  if (usesWindowsCompatibility && wineProfiles.length === 0) {
    throw new Error("cloud_save_restore_profile_unresolved");
  }

  return NativeAddon.resolveRestoreTargets({
    ...pathContext,
    files: manifest.files,
  });
};
