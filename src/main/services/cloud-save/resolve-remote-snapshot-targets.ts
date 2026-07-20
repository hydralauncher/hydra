import { HydraApi } from "@main/services/hydra-api";
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
      item.sizeBytes < 0
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

  return NativeAddon.resolveRestoreTargets({
    ...pathContext,
    files: manifest.files,
  });
};
