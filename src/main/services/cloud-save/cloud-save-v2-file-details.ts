import type {
  CloudSaveState,
  CloudSaveV2ActiveSnapshotFileSource,
  CloudSaveV2FileComparison,
  CloudSaveV2FileDetails,
  CloudSaveV2LocalFile,
  CloudSaveV2LocalFileSource,
  CloudSaveV2RemoteFile,
  GameShop,
  LocalGameSnapshotFile,
  LocalGameSnapshotSourceFile,
  RemoteSnapshotSummary,
  RestoreManifestFile,
  RestoreManifestResponse,
  UserLocationCoverage,
} from "@types";

interface BuildCloudSaveV2FileDetailsInput {
  state: CloudSaveState;
  localFiles: LocalGameSnapshotFile[];
  localSourceFiles: LocalGameSnapshotSourceFile[];
  localTotalSizeBytes: number;
  activeSnapshot: RemoteSnapshotSummary | null;
  remoteFiles: RestoreManifestFile[];
  coverage?: UserLocationCoverage[];
  unresolvedRemoteEntryIds?: string[];
  conflictLogicalFileIds?: string[];
}

interface LoadCloudSaveV2FileDetailsInput
  extends Omit<
    BuildCloudSaveV2FileDetailsInput,
    "remoteFiles" | "activeSnapshot"
  > {
  objectId: string;
  shop: GameShop;
  activeSnapshot: RemoteSnapshotSummary | null;
}

type FileIdentity = { logicalFileId: string };
const indexFiles = <T extends FileIdentity>(files: T[]) => {
  const indexed = new Map<string, T>();
  for (const file of files) {
    if (indexed.has(file.logicalFileId)) {
      throw new Error("Duplicate cloud save logical file identity");
    }
    indexed.set(file.logicalFileId, file);
  }
  return indexed;
};

const userLabel = (file: LocalGameSnapshotFile | RestoreManifestFile) => {
  const storeUser = file.locator.bindings.storeUser;
  if (storeUser.concreteFolderId === "__unbound__") return "Default";
  const display = storeUser.steamId64 ?? storeUser.concreteFolderId;
  const suffix = display.slice(-4);
  return `${storeUser.kind === "validated-account" ? "Steam" : "Profile"} ••••${suffix}`;
};

const toLocalFiles = (
  files: LocalGameSnapshotFile[],
  sourceFiles: LocalGameSnapshotSourceFile[]
): CloudSaveV2LocalFile[] => {
  const sourceByKey = indexFiles(sourceFiles);
  if (sourceFiles.length !== files.length) {
    throw new Error("Local cloud save file sources do not match the snapshot");
  }
  return files.map((file) => {
    const source = sourceByKey.get(file.logicalFileId);
    if (
      !source ||
      source.contentHash !== file.contentHash ||
      source.sizeBytes !== file.sizeBytes
    ) {
      throw new Error("Local cloud save file source does not match snapshot");
    }
    return {
      source: "local",
      logicalFileId: file.logicalFileId,
      variantId: file.variantId,
      ruleId: file.ruleId,
      rawPath: file.locator.rawRule,
      relativePath: file.relativePath,
      absolutePath: source.absolutePath,
      sizeBytes: file.sizeBytes,
      lastModifiedAt: source.lastModifiedAt,
      userLabel: userLabel(file),
    };
  });
};

const toRemoteFiles = (files: RestoreManifestFile[]): CloudSaveV2RemoteFile[] =>
  files.map((file) => ({
    source: "remote",
    logicalFileId: file.logicalFileId,
    variantId: file.variantId,
    ruleId: file.ruleId,
    rawPath: file.locator.rawRule,
    relativePath: file.relativePath,
    sizeBytes: file.sizeBytes,
    lastModifiedAt: file.lastModifiedAt ?? null,
    userLabel: userLabel(file),
  }));

const buildComparisons = (
  localFiles: CloudSaveV2LocalFile[],
  localSnapshotFiles: LocalGameSnapshotFile[],
  remoteFiles: CloudSaveV2RemoteFile[],
  remoteManifestFiles: RestoreManifestFile[]
): CloudSaveV2FileComparison[] => {
  const localByKey = indexFiles(localFiles);
  const localSnapshotByKey = indexFiles(localSnapshotFiles);
  const remoteByKey = indexFiles(remoteFiles);
  const remoteManifestByKey = indexFiles(remoteManifestFiles);
  const ids = new Set([...localByKey.keys(), ...remoteByKey.keys()]);
  return [...ids].sort().map((logicalFileId) => {
    const local = localByKey.get(logicalFileId) ?? null;
    const remote = remoteByKey.get(logicalFileId) ?? null;
    const identity = local ?? remote!;
    let status: CloudSaveV2FileComparison["status"];
    if (!remote) status = "local-only";
    else if (!local) status = "remote-only";
    else {
      const localSnapshot = localSnapshotByKey.get(logicalFileId)!;
      const remoteManifest = remoteManifestByKey.get(logicalFileId)!;
      status =
        localSnapshot.contentHash === remoteManifest.contentHash
          ? "unchanged"
          : "modified";
    }
    return {
      logicalFileId,
      variantId: identity.variantId,
      rawPath: identity.rawPath,
      relativePath: identity.relativePath,
      status,
      local,
      remote,
    };
  });
};

const buildVariants = (
  localFiles: CloudSaveV2LocalFile[],
  remoteFiles: CloudSaveV2RemoteFile[],
  coverage: UserLocationCoverage[]
): CloudSaveV2FileDetails["variants"] => {
  const variants = new Map<
    string,
    CloudSaveV2FileDetails["variants"][number]
  >();
  const logicalIdsByVariant = new Map<string, Set<string>>();
  for (const file of [...localFiles, ...remoteFiles]) {
    const current = variants.get(file.variantId);
    if (!current) {
      variants.set(file.variantId, {
        variantId: file.variantId,
        userLabel: file.userLabel,
        fileCount: 1,
        conflictCount: 0,
        active: false,
        warningCodes: [],
      });
    }
    const ids = logicalIdsByVariant.get(file.variantId) ?? new Set<string>();
    ids.add(file.logicalFileId);
    logicalIdsByVariant.set(file.variantId, ids);
  }
  for (const [variantId, ids] of logicalIdsByVariant) {
    variants.get(variantId)!.fileCount = ids.size;
  }
  for (const item of coverage) {
    if (!item.variantId) continue;
    const variant = variants.get(item.variantId);
    if (!variant) continue;
    variant.active ||= item.authority === "authoritative";
    variant.warningCodes.push(...item.warningCodes);
    variant.warningCodes = [...new Set(variant.warningCodes)].sort();
  }
  return [...variants.values()].sort((left, right) =>
    left.variantId.localeCompare(right.variantId)
  );
};

export const buildCloudSaveV2FileDetails = ({
  state,
  localFiles,
  localSourceFiles,
  localTotalSizeBytes,
  activeSnapshot,
  remoteFiles,
  coverage = [],
  unresolvedRemoteEntryIds = [],
  conflictLogicalFileIds = [],
}: BuildCloudSaveV2FileDetailsInput): CloudSaveV2FileDetails => {
  indexFiles(localFiles);
  indexFiles(remoteFiles);
  if (
    localFiles.reduce((total, file) => total + file.sizeBytes, 0) !==
    localTotalSizeBytes
  ) {
    throw new Error("Local cloud save snapshot size is inconsistent");
  }
  const localFileDetails = toLocalFiles(localFiles, localSourceFiles);
  const local: CloudSaveV2LocalFileSource = {
    kind: "local",
    fileCount: localFileDetails.length,
    totalSizeBytes: localTotalSizeBytes,
    files: localFileDetails,
  };
  const remoteFileDetails = toRemoteFiles(remoteFiles);
  const variants = buildVariants(localFileDetails, remoteFileDetails, coverage);
  const variantById = new Map(
    variants.map((variant) => [variant.variantId, variant])
  );
  const filesById = new Map(
    [...remoteFiles, ...localFiles].map((file) => [file.logicalFileId, file])
  );
  for (const logicalFileId of new Set(conflictLogicalFileIds)) {
    const file = filesById.get(logicalFileId);
    if (!file) throw new Error("Unknown Cloud Save conflict logical file");
    const variant = variantById.get(file.variantId);
    if (variant) variant.conflictCount += 1;
  }
  const unresolvedRemoteVariantCount = new Set(
    remoteFiles
      .filter((file) => unresolvedRemoteEntryIds.includes(file.logicalFileId))
      .map((file) => file.variantId)
  ).size;

  if (state !== "conflict") {
    return {
      state,
      local,
      activeSnapshot: null,
      comparisons: [],
      variants,
      unresolvedRemoteVariantCount,
    };
  }
  if (!activeSnapshot) {
    throw new Error("A cloud save conflict requires an active snapshot");
  }
  const remoteTotalSizeBytes = remoteFiles.reduce(
    (total, file) => total + file.sizeBytes,
    0
  );
  if (
    remoteFiles.length !== activeSnapshot.fileCount ||
    remoteTotalSizeBytes !== activeSnapshot.totalSizeBytes
  ) {
    throw new Error("Active snapshot manifest does not match its summary");
  }
  const remote: CloudSaveV2ActiveSnapshotFileSource = {
    kind: "active-snapshot",
    snapshotId: activeSnapshot.id,
    createdAt: activeSnapshot.createdAt,
    fileCount: remoteFileDetails.length,
    totalSizeBytes: remoteTotalSizeBytes,
    files: remoteFileDetails,
  };
  return {
    state,
    local,
    activeSnapshot: remote,
    comparisons: buildComparisons(
      localFileDetails,
      localFiles,
      remoteFileDetails,
      remoteFiles
    ),
    variants,
    unresolvedRemoteVariantCount,
  };
};

const validateManifestOwnership = (
  manifest: RestoreManifestResponse,
  snapshot: RemoteSnapshotSummary,
  objectId: string,
  shop: GameShop
) => {
  if (
    manifest.snapshot.id !== snapshot.id ||
    manifest.snapshot.objectId !== objectId ||
    manifest.snapshot.shop !== shop
  ) {
    throw new Error("Active snapshot manifest does not belong to the game");
  }
};

export const loadCloudSaveV2FileDetails = async (
  input: LoadCloudSaveV2FileDetailsInput,
  getActiveManifest: (snapshotId: string) => Promise<RestoreManifestResponse>
): Promise<CloudSaveV2FileDetails> => {
  if (input.state !== "conflict") {
    return buildCloudSaveV2FileDetails({
      ...input,
      activeSnapshot: null,
      remoteFiles: [],
    });
  }
  if (!input.activeSnapshot) {
    throw new Error("A cloud save conflict requires an active snapshot");
  }
  const manifest = await getActiveManifest(input.activeSnapshot.id);
  validateManifestOwnership(
    manifest,
    input.activeSnapshot,
    input.objectId,
    input.shop
  );
  return buildCloudSaveV2FileDetails({
    ...input,
    remoteFiles: manifest.files,
  });
};
