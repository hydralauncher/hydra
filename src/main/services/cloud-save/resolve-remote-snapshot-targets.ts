import { HydraApi } from "@main/services/hydra-api";
import { logger } from "@main/services/logger";
import { SystemPath } from "@main/services/system-path";
import { Wine } from "@main/services/wine";
import type {
  CloudSaveCustomPath,
  CloudSavePathContext,
  RemoteGameSnapshot,
  RemoteSnapshotSummary,
  RestoreManifestResponse,
  ResolveRestoreTargetsResult,
} from "@types";

import { NativeAddon } from "../native-addon";
import { validateRestoreManifest } from "./cloud-save-contract";
import { getCloudSaveGameContext } from "./cloud-save-game-context";
import {
  CLOUD_SAVE_CUSTOM_PATH_PREFIX,
  cloudSaveCustomPathContextFromPathContext,
  validateCloudSaveCustomPathForRestore,
} from "./custom-path";
import {
  customPathToCloudSaveRule,
  getCloudSaveCustomPaths,
  getUnavailableCloudSaveCustomPathRawPaths,
} from "./custom-path-store";

const isWinePrefixValid = (winePrefixPath?: string) => {
  if (!winePrefixPath) return false;
  try {
    return Wine.validatePrefix(winePrefixPath);
  } catch {
    return false;
  }
};

export const getRemoteSnapshotRestoreManifest = async (
  snapshot: RemoteSnapshotSummary | RemoteGameSnapshot
): Promise<RestoreManifestResponse> => {
  const manifest = validateRestoreManifest(
    await HydraApi.get<unknown>(
      "/profile/cloud-saves/snapshot-restore-manifest",
      { snapshotId: snapshot.id },
      { needsAuth: true, needsSubscription: true }
    )
  );
  const totalSizeBytes = manifest.files.reduce(
    (total, file) => total + file.sizeBytes,
    0
  );
  if (
    manifest.snapshot.id !== snapshot.id ||
    manifest.snapshot.version !== snapshot.version ||
    manifest.files.length !== snapshot.fileCount ||
    totalSizeBytes !== snapshot.totalSizeBytes ||
    NativeAddon.buildSnapshotAggregateHash({
      variants: manifest.variants,
      files: manifest.files,
    }) !== snapshot.aggregateHash
  ) {
    throw new Error("Restore manifest does not match its snapshot summary");
  }
  return manifest;
};

export const getRestorableCloudSaveCustomPaths = async (
  manifest: RestoreManifestResponse,
  pathContext: Pick<
    CloudSavePathContext,
    | "platform"
    | "homeDir"
    | "documentsDir"
    | "appDataDir"
    | "executablePath"
    | "winePrefixPath"
    | "steamPath"
    | "objectId"
    | "storeUserContext"
  >
): Promise<CloudSaveCustomPath[]> => {
  const rawPaths = [
    ...new Set(
      manifest.files
        .map(({ rawPath }) => rawPath)
        .filter((rawPath) => rawPath.startsWith(CLOUD_SAVE_CUSTOM_PATH_PREFIX))
    ),
  ].sort();
  const customPaths: CloudSaveCustomPath[] = [];
  const customPathContext =
    cloudSaveCustomPathContextFromPathContext(pathContext);
  for (const rawPath of rawPaths) {
    try {
      const customPath = await validateCloudSaveCustomPathForRestore(
        rawPath,
        pathContext.platform,
        customPathContext
      );
      if (customPath) customPaths.push(customPath);
    } catch (error) {
      logger.warn("[Cloud Save] Rejected custom restore path", {
        rawPath,
        error,
      });
    }
  }
  return customPaths;
};

export const resolveRestoreManifestTargets = async (
  manifest: RestoreManifestResponse,
  suppliedPathContext?: CloudSavePathContext
): Promise<ResolveRestoreTargetsResult> => {
  const gameContext = await getCloudSaveGameContext(
    manifest.snapshot.objectId,
    manifest.snapshot.shop
  );
  const pathContext = suppliedPathContext ?? gameContext.pathContext;
  const approved = await NativeAddon.getSaveRulesForGame({
    shop: manifest.snapshot.shop,
    objectId: manifest.snapshot.objectId,
    title: gameContext.game?.title,
    remoteId: gameContext.game?.remoteId ?? undefined,
    userDataPath: SystemPath.getPath("userData"),
  });
  const remoteCustomPaths = await getRestorableCloudSaveCustomPaths(
    manifest,
    pathContext
  );
  const customPathContext =
    cloudSaveCustomPathContextFromPathContext(pathContext);
  const [localCustomPaths, unavailableLocalRawPaths] = await Promise.all([
    getCloudSaveCustomPaths(
      manifest.snapshot.shop,
      manifest.snapshot.objectId,
      customPathContext
    ),
    getUnavailableCloudSaveCustomPathRawPaths(
      manifest.snapshot.shop,
      manifest.snapshot.objectId,
      customPathContext
    ),
  ]);
  const unavailableKeys = new Set(unavailableLocalRawPaths);
  const customPaths = remoteCustomPaths.flatMap((remotePath) => {
    if (unavailableKeys.has(remotePath.rawPath)) {
      return [];
    }
    const localPath = localCustomPaths.find(
      (localPath) => localPath.rawPath === remotePath.rawPath
    );
    return [
      localPath ? { ...localPath, rawPath: remotePath.rawPath } : remotePath,
    ];
  });

  const effectiveWinePrefixPath = customPathContext.winePrefixPath;
  const wineUserProfilePath = customPathContext.wineUserProfilePath;
  const wineProfiles = effectiveWinePrefixPath
    ? Wine.getPrefixUserProfiles(effectiveWinePrefixPath)
    : [];
  const usesWindowsCompatibility =
    pathContext.platform === "linux" &&
    pathContext.executablePath?.toLowerCase().endsWith(".exe") === true;
  const winePrefixIsValid = isWinePrefixValid(effectiveWinePrefixPath);
  logger.info("[Cloud Save] Resolving remote snapshot targets", {
    shop: manifest.snapshot.shop,
    objectId: manifest.snapshot.objectId,
    fileCount: manifest.files.length,
    winePrefixPath: effectiveWinePrefixPath ?? null,
    winePrefixIsValid,
    wineUserProfilePath: wineUserProfilePath ?? null,
    wineProfileCount: wineProfiles.length,
    hasActiveStoreUser: Boolean(pathContext.storeUserContext.active),
    knownStoreUsers: pathContext.storeUserContext.known.length,
  });

  if (usesWindowsCompatibility && !effectiveWinePrefixPath) {
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
    winePrefixPath: effectiveWinePrefixPath,
    approvedRules: [
      ...approved.rules.map(({ kind, rawPath, source }) => ({
        kind,
        rawPath,
        source,
        preferredPath: undefined,
      })),
      ...customPaths.map(customPathToCloudSaveRule),
    ].map(({ kind, rawPath, source, preferredPath }) => ({
      kind,
      rawPath,
      source,
      preferredPath,
    })),
    variants: manifest.variants,
    files: manifest.files,
  });
};
