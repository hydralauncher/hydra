import { randomUUID } from "node:crypto";

import type {
  CloudSaveCustomPathApproval,
  CloudSaveCustomPathApprovalFile,
  GameShop,
  RestoreManifestFile,
} from "@types";

import { analyzeCloudSaveState } from "./analyze-cloud-save-state";
import type { getCloudSaveGameContext } from "./cloud-save-game-context";
import { getUnconfiguredCloudSaveCustomPathCandidates } from "./custom-path-approval-policy";
import {
  bindCloudSaveCustomPathToLocalPath,
  canonicalizeSelectedCloudSaveCustomPath,
  cloudSaveCustomPathContextFromPathContext,
  decodeCloudSaveCustomPath,
  validateBoundCloudSaveCustomPathForRestore,
  validateCloudSaveCustomPathForRestore,
} from "./custom-path";
import { getCloudSaveCustomPathBindings } from "./custom-path-store";
import { buildCloudSaveCustomPathRebindApproval } from "./custom-path-rebind-approval";
import {
  assertCloudSaveCustomPathDoesNotOverlap,
  getUsableCloudSaveCustomPathBindings,
  registerCloudSaveCustomPathWithoutOverlap,
} from "./custom-path-overlap";
import { assertCloudSaveDeletionInactive } from "./operation-gate";

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
  approvedSelectedPath?: string | null;
}

const pendingByGame = new Map<string, PendingCloudSaveCustomPathApproval>();

const gameKey = (shop: GameShop, objectId: string) =>
  JSON.stringify([shop, objectId]);

const getFileName = (relativePath: string) =>
  relativePath.replaceAll("\\", "/").split("/").findLast(Boolean) ??
  relativePath;

const toApprovalFiles = (
  files: RestoreManifestFile[]
): CloudSaveCustomPathApprovalFile[] =>
  [...files]
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    .map((file) => ({
      name: getFileName(file.relativePath),
      relativePath: file.relativePath,
      sizeBytes: file.sizeBytes,
      lastModifiedAt: file.lastModifiedAt,
    }));

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
  if (!manifest) {
    clearPending();
    return null;
  }

  const customPathContext = cloudSaveCustomPathContextFromPathContext(
    context.pathContext
  );
  const locallyBoundRawPaths = new Set(
    (
      await getUsableCloudSaveCustomPathBindings(objectId, shop, context, {
        remoteFiles: manifest.files,
      })
    ).ready.map(({ rawPath }) => rawPath)
  );
  const candidates = getUnconfiguredCloudSaveCustomPathCandidates(
    manifest.files,
    locallyBoundRawPaths
  );

  const candidate = candidates[0];
  if (!candidate) {
    clearPending();
    return null;
  }

  const { rawPath, files } = candidate;
  let suggestedPath: string | null = null;
  try {
    suggestedPath = decodeCloudSaveCustomPath(rawPath, customPathContext).path;
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
      if (canUseSuggestedPath) {
        await assertCloudSaveCustomPathDoesNotOverlap({
          objectId,
          shop,
          selectedPath: suggestedPath,
          context,
          currentRawPath: rawPath,
          remoteRelativePaths: files.map(({ relativePath }) => relativePath),
        });
      }
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
    files: toApprovalFiles(files),
    snapshotId: manifest.snapshot.id,
    snapshotVersion: manifest.snapshot.version,
  };
  pendingByGame.set(key, { approval, launchOptions, context });
  return approval;
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

export const createPendingCustomPathRebindApproval = async (
  gameId: { shop: GameShop; objectId: string },
  rawPath: string,
  context: CloudSaveGameContext
): Promise<CloudSaveCustomPathApproval> => {
  if (!rawPath.startsWith("<custom>")) {
    throw new Error("cloud_save_custom_path_invalid");
  }

  const { shop, objectId } = gameId;
  const analysis = await analyzeCloudSaveState(
    objectId,
    shop,
    context,
    "restore-only"
  );
  const customPathContext = cloudSaveCustomPathContextFromPathContext(
    context.pathContext
  );
  const bindings = await getCloudSaveCustomPathBindings(
    shop,
    objectId,
    customPathContext
  );
  const readyBinding = bindings.ready.find(
    (binding) => binding.rawPath === rawPath
  );
  const unresolvedBinding = bindings.unresolved.find(
    (binding) => binding.rawPath === rawPath
  );
  const remoteFiles = analysis.remoteManifest?.files ?? [];
  const matchingRemoteFiles = remoteFiles.filter(
    (file) => file.rawPath === rawPath
  );

  if (!readyBinding && !unresolvedBinding && matchingRemoteFiles.length === 0) {
    throw new Error("cloud_save_custom_path_not_registered");
  }

  let suggestedPath = readyBinding?.path ?? unresolvedBinding?.pathHint ?? null;
  let selectedPath = readyBinding?.path ?? null;
  let canUseSuggestedPath = false;

  if (!readyBinding) {
    try {
      suggestedPath = decodeCloudSaveCustomPath(
        rawPath,
        customPathContext
      ).path;
      canUseSuggestedPath =
        (await validateCloudSaveCustomPathForRestore(
          rawPath,
          context.pathContext.platform,
          customPathContext
        )) !== null;
      selectedPath = canUseSuggestedPath ? suggestedPath : null;
    } catch {
      canUseSuggestedPath = false;
      selectedPath = null;
    }
  }
  if (selectedPath) {
    try {
      await assertCloudSaveCustomPathDoesNotOverlap({
        objectId,
        shop,
        selectedPath,
        context,
        currentRawPath: rawPath,
        remoteRelativePaths: matchingRemoteFiles.map(
          ({ relativePath }) => relativePath
        ),
      });
    } catch {
      selectedPath = null;
      canUseSuggestedPath = false;
    }
  }

  const approval = buildCloudSaveCustomPathRebindApproval({
    gameId,
    rawPath,
    suggestedPath,
    selectedPath,
    canUseSuggestedPath,
    remoteFiles,
    snapshot: analysis.remoteManifest?.snapshot ?? null,
  });
  pendingByGame.set(gameKey(shop, objectId), {
    approval,
    launchOptions: null,
    context,
    approvedSelectedPath: readyBinding?.path ?? null,
  });
  return approval;
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
  await assertCloudSaveCustomPathDoesNotOverlap({
    objectId: pending.approval.gameId.objectId,
    shop: pending.approval.gameId.shop,
    selectedPath: selected.path,
    context: pending.context,
    currentRawPath: pending.approval.rawPath,
    remoteRelativePaths: pending.approval.files.map(
      ({ relativePath }) => relativePath
    ),
  });
  pending.approval = {
    ...pending.approval,
    selectedPath: selected.path,
  };
  pending.approvedSelectedPath = null;
  return pending.approval;
};

const bindPendingCloudSaveCustomPathApproval = async (
  id: string,
  purpose: CloudSaveCustomPathApproval["purpose"],
  removePending: boolean,
  assertCanBind?: () => void
) => {
  const pending = getPendingById(id);
  const { objectId, shop } = pending.approval.gameId;
  const assertCanRegister = () => {
    assertCloudSaveDeletionInactive(objectId, shop);
    assertCanBind?.();
  };
  assertCanRegister();
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
  if (
    pending.approvedSelectedPath &&
    selectedPath === pending.approvedSelectedPath
  ) {
    selectedPath = (
      await validateBoundCloudSaveCustomPathForRestore(
        approval.rawPath,
        pending.approvedSelectedPath,
        customPathContext
      )
    ).path;
  } else if (
    selectedPath === approval.suggestedPath &&
    approval.canUseSuggestedPath
  ) {
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
  await registerCloudSaveCustomPathWithoutOverlap({
    objectId: approval.gameId.objectId,
    shop: approval.gameId.shop,
    customPath: binding,
    context,
    currentRawPath: approval.rawPath,
    remoteRelativePaths: approval.files.map(({ relativePath }) => relativePath),
    assertCanRegister,
  });
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

export const confirmPendingCustomPathRebindApproval = async (
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
  const customPathContext = cloudSaveCustomPathContextFromPathContext(
    pending.context.pathContext
  );
  const bindings = await getCloudSaveCustomPathBindings(
    gameId.shop,
    gameId.objectId,
    customPathContext
  );
  let isKnown = [...bindings.ready, ...bindings.unresolved].some(
    (binding) => binding.rawPath === pending.approval.rawPath
  );
  if (!isKnown) {
    const analysis = await analyzeCloudSaveState(
      gameId.objectId,
      gameId.shop,
      pending.context,
      "restore-only"
    );
    isKnown =
      analysis.remoteManifest?.files.some(
        (file) => file.rawPath === pending.approval.rawPath
      ) ?? false;
  }
  if (!isKnown) {
    throw new Error("cloud_save_custom_path_not_registered");
  }
  const { approval } = await bindPendingCloudSaveCustomPathApproval(
    id,
    "custom-path-rebind",
    true,
    assertCanBind
  );
  return { rawPath: approval.rawPath };
};

export const dismissPendingCloudSaveCustomPathApproval = (id: string) => {
  const pending = getPendingById(id);
  pendingByGame.delete(
    gameKey(pending.approval.gameId.shop, pending.approval.gameId.objectId)
  );
};

export const dismissPendingCloudSaveCustomPathApprovalForRawPath = (
  shop: GameShop,
  objectId: string,
  rawPath: string
) => {
  const key = gameKey(shop, objectId);
  if (pendingByGame.get(key)?.approval.rawPath === rawPath) {
    pendingByGame.delete(key);
  }
};
