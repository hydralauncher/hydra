import { HydraApi } from "@main/services/hydra-api";
import { logger } from "@main/services/logger";
import { SystemPath } from "@main/services/system-path";
import { Wine } from "@main/services/wine";
import type {
  CloudSavePathContext,
  GameShop,
  RestoreManifestResponse,
  ResolveRestoreTargetsResult,
} from "@types";

import { NativeAddon } from "../native-addon";
import { validateUniqueLogicalFiles } from "./cloud-save-contract";
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
    typeof snapshot.revision !== "number" ||
    !Number.isInteger(snapshot.revision) ||
    snapshot.revision < 0 ||
    !isNonEmptyString(snapshot.aggregateHash) ||
    typeof snapshot.schemaVersion !== "number" ||
    !Number.isInteger(snapshot.schemaVersion) ||
    snapshot.schemaVersion < 1 ||
    !Array.isArray(response.files)
  ) {
    throw new Error("Invalid restore manifest response");
  }

  const files = validateUniqueLogicalFiles(response.files);
  for (const file of files) {
    const item = file as unknown as Record<string, unknown>;
    if (
      item.lastModifiedAt !== undefined &&
      item.lastModifiedAt !== null &&
      (!isNonEmptyString(item.lastModifiedAt) ||
        !Number.isFinite(Date.parse(item.lastModifiedAt)))
    ) {
      throw new Error("Invalid restore manifest file");
    }
    if (
      file.locator.bindings.store !== snapshot.shop ||
      file.locator.bindings.storeGameId !== snapshot.objectId
    ) {
      throw new Error("Invalid restore manifest locator");
    }
  }

  if (
    NativeAddon.buildSnapshotAggregateHash({
      schemaVersion: snapshot.schemaVersion as number,
      saveNamespaceKey: `${snapshot.shop}:${snapshot.objectId}`,
      files,
    }) !== snapshot.aggregateHash
  ) {
    throw new Error("Restore manifest aggregate hash is inconsistent");
  }

  return { ...(value as RestoreManifestResponse), files };
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
    wineProfileCount: wineProfiles.length,
    hasActiveStoreUser: Boolean(pathContext.storeUserContext.active),
    knownStoreUsers: pathContext.storeUserContext.known.length,
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
    approvedRules: approved.rules.map(({ ruleId, rawPath, source }) => ({
      ruleId,
      rawPath,
      source,
    })),
    files: manifest.files,
  });
};
