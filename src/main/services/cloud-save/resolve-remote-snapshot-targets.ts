import { HydraApi } from "@main/services/hydra-api";
import { logger } from "@main/services/logger";
import { SystemPath } from "@main/services/system-path";
import { Wine } from "@main/services/wine";
import type {
  CloudSavePathContext,
  RemoteGameSnapshot,
  RemoteSnapshotSummary,
  RestoreManifestResponse,
  ResolveRestoreTargetsResult,
} from "@types";

import { NativeAddon } from "../native-addon";
import { validateRestoreManifest } from "./cloud-save-contract";
import { getCloudSaveGameContext } from "./cloud-save-game-context";
import { cloudSaveCustomPathContextFromPathContext } from "./custom-path";
import {
  customPathToCloudSaveRule,
  getCloudSaveCustomPathBindings,
} from "./custom-path-store";
import { storeUserContextWithSnapshotAccounts } from "./snapshot-store-user-context";

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
  const customPathContext =
    cloudSaveCustomPathContextFromPathContext(pathContext);
  const { ready: customPaths } = await getCloudSaveCustomPathBindings(
    manifest.snapshot.shop,
    manifest.snapshot.objectId,
    customPathContext
  );

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
    storeUserContext: storeUserContextWithSnapshotAccounts(
      pathContext.storeUserContext,
      manifest.variants
    ),
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
