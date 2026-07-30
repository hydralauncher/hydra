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
  getCloudSaveCustomPathBindings,
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
  launchOptions: CloudSavePendingLaunchOptions | null;
  context: CloudSaveGameContext;
}

const pendingByGame = new Map<string, PendingCloudSaveCustomPathApproval>();

const gameKey = (shop: GameShop, objectId: string) =>
  JSON.stringify([shop, objectId]);

const getFileName = (relativePath: string) =>
  relativePath.replaceAll("\\", "/").split("/").filter(Boolean).pop() ??
  relativePath;

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

const createPendingApproval = async (
  gameId: { shop: GameShop; objectId: string },
  purpose: CloudSaveCustomPathApproval["purpose"],
  context: CloudSaveGameContext,
  launchOptions: CloudSavePendingLaunchOptions | null,
  preservePendingId?: string
): Promise<CloudSaveCustomPathApproval | null> => {
  const { shop, objectId } = gameId;
  const key = gameKey(shop, objectId);
  const clearPending = () => {
    if (pendingByGame.get(key)?.approval.id !== preservePendingId) {
      pendingByGame.delete(key);
    }
  };
  const analysis = await analyzeCloudSaveState(
    objectId,
    shop,
    context,
    "restore-only"
  );
  const manifest = analysis.remoteManifest;
  if (!manifest || analysis.merge.restoreEntryIds.length === 0) {
    clearPending();
    return null;
  }

  const customPathContext = cloudSaveCustomPathContextFromPathContext(
    context.pathContext
  );
  const locallyBoundRawPaths = new Set(
    (
      await getCloudSaveCustomPathBindings(shop, objectId, customPathContext)
    ).ready.map(({ rawPath }) => rawPath)
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
      purpose,
      rawPath,
      suggestedPath,
      selectedPath: canUseSuggestedPath ? suggestedPath : null,
      canUseSuggestedPath,
      fileCount: files.length,
      totalSizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
      files: [...files]
        .sort((left, right) =>
          left.relativePath.localeCompare(right.relativePath)
        )
        .map((file) => ({
          name: getFileName(file.relativePath),
          relativePath: file.relativePath,
          sizeBytes: file.sizeBytes,
          lastModifiedAt: file.lastModifiedAt,
        })),
      snapshotId: manifest.snapshot.id,
      snapshotVersion: manifest.snapshot.version,
    };
    pendingByGame.set(key, { approval, launchOptions, context });
    return approval;
  }

  clearPending();
  return null;
};

export const createPendingCloudSaveCustomPathApproval = (
  launchOptions: CloudSavePendingLaunchOptions,
  context: CloudSaveGameContext
) => createPendingApproval(launchOptions, "pre-launch", context, launchOptions);

export const createPendingManualCloudSaveCustomPathApproval = (
  gameId: { shop: GameShop; objectId: string },
  context: CloudSaveGameContext,
  preservePendingId?: string
) =>
  createPendingApproval(
    gameId,
    "manual-sync",
    context,
    null,
    preservePendingId
  );

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

const bindPendingCloudSaveCustomPathApproval = async (
  id: string,
  purpose: CloudSaveCustomPathApproval["purpose"],
  removePending: boolean,
  assertCanBind?: () => void
) => {
  const pending = getPendingById(id);
  if (pending.approval.purpose !== purpose) {
    throw new Error("cloud_save_custom_path_approval_purpose_mismatch");
  }
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
  assertCanBind?.();
  await registerCloudSaveCustomPaths(
    approval.gameId.shop,
    approval.gameId.objectId,
    [binding]
  );
  if (removePending) {
    pendingByGame.delete(
      gameKey(approval.gameId.shop, approval.gameId.objectId)
    );
  }
  return { approval, launchOptions };
};

export const confirmPendingCloudSaveCustomPathApproval = async (id: string) => {
  const { launchOptions } = await bindPendingCloudSaveCustomPathApproval(
    id,
    "pre-launch",
    true
  );
  if (!launchOptions) {
    throw new Error("cloud_save_custom_path_approval_launch_missing");
  }
  return launchOptions;
};

export const confirmPendingManualCloudSaveCustomPathApproval = async (
  id: string,
  gameId: { shop: GameShop; objectId: string },
  assertCanBind?: () => void
) => {
  const pending = getPendingById(id);
  if (
    pending.approval.gameId.shop !== gameId.shop ||
    pending.approval.gameId.objectId !== gameId.objectId
  ) {
    throw new Error("cloud_save_custom_path_approval_game_mismatch");
  }
  await bindPendingCloudSaveCustomPathApproval(
    id,
    "manual-sync",
    false,
    assertCanBind
  );
};

export const dismissPendingCloudSaveCustomPathApproval = (id: string) => {
  const pending = getPendingById(id);
  pendingByGame.delete(
    gameKey(pending.approval.gameId.shop, pending.approval.gameId.objectId)
  );
};
