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
} from "@types";

interface BuildCloudSaveV2FileDetailsInput {
  state: CloudSaveState;
  localFiles: LocalGameSnapshotFile[];
  localSourceFiles: LocalGameSnapshotSourceFile[];
  localTotalSizeBytes: number;
  activeSnapshot: RemoteSnapshotSummary | null;
  remoteFiles: RestoreManifestFile[];
}

interface LoadCloudSaveV2FileDetailsInput {
  objectId: string;
  shop: GameShop;
  state: CloudSaveState;
  localFiles: LocalGameSnapshotFile[];
  localSourceFiles: LocalGameSnapshotSourceFile[];
  localTotalSizeBytes: number;
  activeSnapshot: RemoteSnapshotSummary | null;
}

type FileIdentity = Pick<LocalGameSnapshotFile, "rawPath" | "relativePath">;

const fileKey = (file: FileIdentity) =>
  JSON.stringify([file.rawPath, file.relativePath]);

const compareIdentities = (left: FileIdentity, right: FileIdentity) =>
  left.rawPath.localeCompare(right.rawPath, undefined, {
    numeric: true,
    sensitivity: "base",
  }) ||
  left.relativePath.localeCompare(right.relativePath, undefined, {
    numeric: true,
    sensitivity: "base",
  });

const indexFiles = <T extends FileIdentity>(files: T[]) => {
  const indexed = new Map<string, T>();

  for (const file of files) {
    const key = fileKey(file);
    if (indexed.has(key)) {
      throw new Error("Duplicate cloud save file identity");
    }
    indexed.set(key, file);
  }

  return indexed;
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
    const source = sourceByKey.get(fileKey(file));
    if (
      !source ||
      source.hash !== file.hash ||
      source.sizeBytes !== file.sizeBytes
    ) {
      throw new Error(
        "Local cloud save file source does not match the snapshot"
      );
    }

    return {
      source: "local",
      rawPath: file.rawPath,
      relativePath: file.relativePath,
      absolutePath: source.absolutePath,
      sizeBytes: file.sizeBytes,
      lastModifiedAt: file.lastModifiedAt,
    };
  });
};

const toRemoteFiles = (files: RestoreManifestFile[]): CloudSaveV2RemoteFile[] =>
  files.map((file) => ({
    source: "remote",
    rawPath: file.rawPath,
    relativePath: file.relativePath,
    sizeBytes: file.sizeBytes,
    lastModifiedAt: file.lastModifiedAt ?? null,
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
  const identities = new Map<string, FileIdentity>();

  for (const file of [...localFiles, ...remoteFiles]) {
    identities.set(fileKey(file), file);
  }

  return Array.from(identities.values())
    .sort(compareIdentities)
    .map((identity) => {
      const key = fileKey(identity);
      const local = localByKey.get(key) ?? null;
      const remote = remoteByKey.get(key) ?? null;
      let status: CloudSaveV2FileComparison["status"];

      if (!remote) status = "local-only";
      else if (!local) status = "remote-only";
      else {
        const localSnapshotFile = localSnapshotByKey.get(key);
        const remoteManifestFile = remoteManifestByKey.get(key);
        if (!localSnapshotFile || !remoteManifestFile) {
          throw new Error("Cloud save comparison source is missing");
        }
        status =
          localSnapshotFile.hash === remoteManifestFile.hash
            ? "unchanged"
            : "modified";
      }

      return {
        rawPath: identity.rawPath,
        relativePath: identity.relativePath,
        status,
        local,
        remote,
      };
    });
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

export const buildCloudSaveV2FileDetails = ({
  state,
  localFiles,
  localSourceFiles,
  localTotalSizeBytes,
  activeSnapshot,
  remoteFiles,
}: BuildCloudSaveV2FileDetailsInput): CloudSaveV2FileDetails => {
  indexFiles(localFiles);
  indexFiles(remoteFiles);

  const calculatedLocalSize = localFiles.reduce(
    (total, file) => total + file.sizeBytes,
    0
  );
  if (calculatedLocalSize !== localTotalSizeBytes) {
    throw new Error("Local cloud save snapshot size is inconsistent");
  }

  const localFileDetails = toLocalFiles(localFiles, localSourceFiles);
  const local: CloudSaveV2LocalFileSource = {
    kind: "local",
    fileCount: localFileDetails.length,
    totalSizeBytes: localTotalSizeBytes,
    files: localFileDetails,
  };

  if (state !== "conflict") {
    if (activeSnapshot || remoteFiles.length > 0) {
      throw new Error(
        "Remote file details are only available during conflicts"
      );
    }

    return {
      state,
      local,
      activeSnapshot: null,
      comparisons: [],
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

  const remoteFileDetails = toRemoteFiles(remoteFiles);
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
  };
};

export const loadCloudSaveV2FileDetails = async (
  {
    objectId,
    shop,
    state,
    localFiles,
    localSourceFiles,
    localTotalSizeBytes,
    activeSnapshot,
  }: LoadCloudSaveV2FileDetailsInput,
  getActiveManifest: (snapshotId: string) => Promise<RestoreManifestResponse>
): Promise<CloudSaveV2FileDetails> => {
  if (state !== "conflict") {
    return buildCloudSaveV2FileDetails({
      state,
      localFiles,
      localSourceFiles,
      localTotalSizeBytes,
      activeSnapshot: null,
      remoteFiles: [],
    });
  }

  if (!activeSnapshot) {
    throw new Error("A cloud save conflict requires an active snapshot");
  }

  const manifest = await getActiveManifest(activeSnapshot.id);
  validateManifestOwnership(manifest, activeSnapshot, objectId, shop);

  return buildCloudSaveV2FileDetails({
    state,
    localFiles,
    localSourceFiles,
    localTotalSizeBytes,
    activeSnapshot,
    remoteFiles: manifest.files,
  });
};
