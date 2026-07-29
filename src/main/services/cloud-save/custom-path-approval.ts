import { randomUUID } from "node:crypto";

import type { CloudSaveCustomPathApproval, GameShop } from "@types";

import { analyzeCloudSaveState } from "./analyze-cloud-save-state";
import type { getCloudSaveGameContext } from "./cloud-save-game-context";
import { getUnboundCloudSaveCustomPathRestoreCandidates } from "./custom-path-approval-policy";
import {
  bindCloudSaveCustomPathToLocalPath,
  canonicalizeSelectedCloudSaveCustomPath,
  cloudSaveCustomPathContextFromPathContext,
  decodeCloudSaveCustomPath,
  validateCloudSaveCustomPathForRestore,
} from "./custom-path";
import {
  getCloudSaveCustomPaths,
  registerCloudSaveCustomPaths,
} from "./custom-path-store";

export interface CloudSavePendingLaunchOptions {
  shop: GameShop;
  objectId: string;
  executablePath: string;
  launchOptions?: string | null;
}

type CloudSaveGameContext = Awaited<ReturnType<typeof getCloudSaveGameContext>>;

interface PendingCloudSaveCustomPathApproval {
  approval: CloudSaveCustomPathApproval;
  launchOptions: CloudSavePendingLaunchOptions;
  context: CloudSaveGameContext;
}

const pendingByGame = new Map<string, PendingCloudSaveCustomPathApproval>();

const gameKey = (shop: GameShop, objectId: string) =>
  JSON.stringify([shop, objectId]);

const getPendingById = (id: string) => {
  for (const pending of pendingByGame.values()) {
    if (pending.approval.id === id) return pending;
  }
  throw new Error("cloud_save_custom_path_approval_not_found");
};

export const getPendingCloudSaveCustomPathApprovalById = (id: string) =>
  getPendingById(id).approval;

export const getPendingCloudSaveCustomPathApproval = (
  shop: GameShop,
  objectId: string
) => pendingByGame.get(gameKey(shop, objectId))?.approval ?? null;

export const createPendingCloudSaveCustomPathApproval = async (
  launchOptions: CloudSavePendingLaunchOptions,
  context: CloudSaveGameContext
): Promise<CloudSaveCustomPathApproval | null> => {
  const { shop, objectId } = launchOptions;
  const key = gameKey(shop, objectId);
  const analysis = await analyzeCloudSaveState(
    objectId,
    shop,
    context,
    "restore-only"
  );
  const manifest = analysis.remoteManifest;
  if (!manifest || analysis.merge.restoreEntryIds.length === 0) {
    pendingByGame.delete(key);
    return null;
  }

  const customPathContext = cloudSaveCustomPathContextFromPathContext(
    context.pathContext
  );
  const locallyBoundRawPaths = new Set(
    (await getCloudSaveCustomPaths(shop, objectId, customPathContext)).map(
      ({ rawPath }) => rawPath
    )
  );
  const candidates = getUnboundCloudSaveCustomPathRestoreCandidates(
    manifest.files,
    analysis.merge.restoreEntryIds,
    locallyBoundRawPaths
  );

  for (const { rawPath, files } of candidates) {
    let suggestedPath: string | null = null;
    try {
      suggestedPath = decodeCloudSaveCustomPath(
        rawPath,
        customPathContext
      ).path;
    } catch {
      suggestedPath = null;
    }

    let canUseSuggestedPath = false;
    if (suggestedPath) {
      try {
        canUseSuggestedPath =
          (await validateCloudSaveCustomPathForRestore(
            rawPath,
            context.pathContext.platform,
            customPathContext
          )) !== null;
      } catch {
        canUseSuggestedPath = false;
      }
    }

    const approval: CloudSaveCustomPathApproval = {
      id: randomUUID(),
      gameId: { shop, objectId },
      rawPath,
      suggestedPath,
      selectedPath: canUseSuggestedPath ? suggestedPath : null,
      canUseSuggestedPath,
      fileCount: files.length,
      totalSizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
      snapshotId: manifest.snapshot.id,
      snapshotVersion: manifest.snapshot.version,
    };
    pendingByGame.set(key, { approval, launchOptions, context });
    return approval;
  }

  pendingByGame.delete(key);
  return null;
};

export const selectPendingCloudSaveCustomPathApproval = async (
  id: string,
  selectedPath: string
) => {
  const pending = getPendingById(id);
  const customPathContext = cloudSaveCustomPathContextFromPathContext(
    pending.context.pathContext
  );
  const selected = await canonicalizeSelectedCloudSaveCustomPath(
    selectedPath,
    customPathContext
  );
  pending.approval = {
    ...pending.approval,
    selectedPath: selected.path,
  };
  return pending.approval;
};

export const confirmPendingCloudSaveCustomPathApproval = async (id: string) => {
  const pending = getPendingById(id);
  const { approval, launchOptions, context } = pending;
  if (!approval.selectedPath) {
    throw new Error("cloud_save_custom_path_approval_path_required");
  }

  const customPathContext = cloudSaveCustomPathContextFromPathContext(
    context.pathContext
  );
  let selectedPath = approval.selectedPath;
  if (selectedPath === approval.suggestedPath && approval.canUseSuggestedPath) {
    const validated = await validateCloudSaveCustomPathForRestore(
      approval.rawPath,
      context.pathContext.platform,
      customPathContext
    );
    if (!validated) {
      throw new Error("cloud_save_custom_path_approval_path_required");
    }
    selectedPath = validated.path;
  } else {
    selectedPath = (
      await canonicalizeSelectedCloudSaveCustomPath(
        selectedPath,
        customPathContext
      )
    ).path;
  }

  const binding = bindCloudSaveCustomPathToLocalPath(
    approval.rawPath,
    selectedPath,
    customPathContext
  );
  await registerCloudSaveCustomPaths(
    approval.gameId.shop,
    approval.gameId.objectId,
    [binding]
  );
  pendingByGame.delete(gameKey(approval.gameId.shop, approval.gameId.objectId));
  return launchOptions;
};

export const dismissPendingCloudSaveCustomPathApproval = (id: string) => {
  const pending = getPendingById(id);
  pendingByGame.delete(
    gameKey(pending.approval.gameId.shop, pending.approval.gameId.objectId)
  );
};
