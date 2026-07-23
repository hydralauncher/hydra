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
  SnapshotVariant,
  UserLocationCoverage,
} from "@types";

import { cloudSaveFileKey } from "./cloud-save-contract.js";

interface BuildCloudSaveV2FileDetailsInput {
  state: CloudSaveState;
  localVariants: SnapshotVariant[];
  localFiles: LocalGameSnapshotFile[];
  localSourceFiles: LocalGameSnapshotSourceFile[];
  localTotalSizeBytes: number;
  activeSnapshot: RemoteSnapshotSummary | null;
  remoteVariants: SnapshotVariant[];
  remoteFiles: RestoreManifestFile[];
  coverage?: UserLocationCoverage[];
  unresolvedRemoteEntryIds?: string[];
  conflictEntryIds?: string[];
}

interface LoadCloudSaveV2FileDetailsInput
  extends Omit<
    BuildCloudSaveV2FileDetailsInput,
    "remoteVariants" | "remoteFiles"
  > {
  objectId: string;
  shop: GameShop;
}

const indexFiles = <
  T extends { variantId: string; rawPath: string; relativePath: string },
>(
  files: T[]
) => {
  const indexed = new Map<string, T>();
  for (const file of files) {
    const key = cloudSaveFileKey(file);
    if (indexed.has(key)) {
      throw new Error("Duplicate composite cloud save file identity");
    }
    indexed.set(key, file);
  }
  return indexed;
};

const indexVariants = (variants: SnapshotVariant[]) => {
  const result = new Map<string, SnapshotVariant>();
  for (const variant of variants) {
    const current = result.get(variant.variantId);
    if (current && JSON.stringify(current) !== JSON.stringify(variant)) {
      throw new Error("Divergent Cloud Save variant metadata");
    }
    result.set(variant.variantId, variant);
  }
  return result;
};

const userLabel = (variant: SnapshotVariant) => {
  if (variant.kind === "default") return "Default";
  const display =
    variant.kind === "steam-account"
      ? variant.steamId64
      : variant.concreteFolderId;
  return `${variant.kind === "steam-account" ? "Steam" : "Profile"} ••••${display.slice(-4)}`;
};

const toLocalFiles = (
  files: LocalGameSnapshotFile[],
  sourceFiles: LocalGameSnapshotSourceFile[],
  variants: Map<string, SnapshotVariant>
): CloudSaveV2LocalFile[] => {
  const sourceByKey = indexFiles(sourceFiles);
  if (sourceFiles.length !== files.length) {
    throw new Error("Local cloud save file sources do not match the snapshot");
  }
  return files.map((file) => {
    const source = sourceByKey.get(cloudSaveFileKey(file));
    const variant = variants.get(file.variantId);
    if (
      !source ||
      !variant ||
      source.hash !== file.hash ||
      source.sizeBytes !== file.sizeBytes
    ) {
      throw new Error("Local cloud save source does not match its snapshot");
    }
    return {
      source: "local",
      variantId: file.variantId,
      rawPath: file.rawPath,
      relativePath: file.relativePath,
      absolutePath: source.absolutePath,
      sizeBytes: file.sizeBytes,
      lastModifiedAt: source.lastModifiedAt,
      userLabel: userLabel(variant),
    };
  });
};

const toRemoteFiles = (
  files: RestoreManifestFile[],
  variants: Map<string, SnapshotVariant>
): CloudSaveV2RemoteFile[] =>
  files.map((file) => {
    const variant = variants.get(file.variantId);
    if (!variant) throw new Error("Remote Cloud Save variant is missing");
    return {
      source: "remote",
      variantId: file.variantId,
      rawPath: file.rawPath,
      relativePath: file.relativePath,
      sizeBytes: file.sizeBytes,
      lastModifiedAt: file.lastModifiedAt,
      userLabel: userLabel(variant),
    };
  });

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
  return [...ids].sort().map((entryId) => {
    const local = localByKey.get(entryId) ?? null;
    const remote = remoteByKey.get(entryId) ?? null;
    const identity = local ?? remote!;
    let status: CloudSaveV2FileComparison["status"];
    if (!remote) status = "local-only";
    else if (!local) status = "remote-only";
    else {
      status =
        localSnapshotByKey.get(entryId)!.hash ===
        remoteManifestByKey.get(entryId)!.hash
          ? "unchanged"
          : "modified";
    }
    return {
      variantId: identity.variantId,
      rawPath: identity.rawPath,
      relativePath: identity.relativePath,
      status,
      local,
      remote,
    };
  });
};

export const buildCloudSaveV2FileDetails = ({
  state,
  localVariants,
  localFiles,
  localSourceFiles,
  localTotalSizeBytes,
  activeSnapshot,
  remoteVariants,
  remoteFiles,
  coverage = [],
  unresolvedRemoteEntryIds = [],
  conflictEntryIds = [],
}: BuildCloudSaveV2FileDetailsInput): CloudSaveV2FileDetails => {
  const variantById = indexVariants([...localVariants, ...remoteVariants]);
  indexFiles(localFiles);
  indexFiles(remoteFiles);
  if (
    localFiles.reduce((total, file) => total + file.sizeBytes, 0) !==
    localTotalSizeBytes
  ) {
    throw new Error("Local cloud save snapshot size is inconsistent");
  }
  const localFileDetails = toLocalFiles(
    localFiles,
    localSourceFiles,
    variantById
  );
  const remoteFileDetails = toRemoteFiles(remoteFiles, variantById);
  const idsByVariant = new Map<string, Set<string>>();
  for (const file of [...localFileDetails, ...remoteFileDetails]) {
    const ids = idsByVariant.get(file.variantId) ?? new Set();
    ids.add(cloudSaveFileKey(file));
    idsByVariant.set(file.variantId, ids);
  }
  const variants: CloudSaveV2FileDetails["variants"] = [
    ...idsByVariant.entries(),
  ]
    .map(([variantId, ids]) => {
      const variant = variantById.get(variantId)!;
      const variantCoverage = coverage.filter(
        (item) => item.variantId === variantId
      );
      return {
        variantId,
        userLabel: userLabel(variant),
        fileCount: ids.size,
        conflictCount: conflictEntryIds.filter((entryId) =>
          [...ids].some((candidate) => candidate === entryId)
        ).length,
        active: variantCoverage.some(
          (item) => item.authority === "authoritative"
        ),
        warningCodes: [
          ...new Set(variantCoverage.flatMap((item) => item.warningCodes)),
        ].sort(),
      };
    })
    .sort((left, right) => left.variantId.localeCompare(right.variantId));

  const unresolvedRemoteVariantCount = new Set(
    remoteFiles
      .filter((file) =>
        unresolvedRemoteEntryIds.includes(cloudSaveFileKey(file))
      )
      .map((file) => file.variantId)
  ).size;
  const local: CloudSaveV2LocalFileSource = {
    kind: "local",
    fileCount: localFileDetails.length,
    totalSizeBytes: localTotalSizeBytes,
    files: localFileDetails,
  };

  let remote: CloudSaveV2ActiveSnapshotFileSource | null = null;
  if (activeSnapshot) {
    const totalSizeBytes = remoteFiles.reduce(
      (total, file) => total + file.sizeBytes,
      0
    );
    if (
      remoteFiles.length !== activeSnapshot.fileCount ||
      totalSizeBytes !== activeSnapshot.totalSizeBytes
    ) {
      throw new Error("Active snapshot manifest does not match its summary");
    }
    remote = {
      kind: "active-snapshot",
      snapshotId: activeSnapshot.id,
      version: activeSnapshot.version,
      updatedAt: activeSnapshot.updatedAt,
      fileCount: remoteFileDetails.length,
      totalSizeBytes,
      files: remoteFileDetails,
    };
  } else if (remoteFiles.length > 0) {
    throw new Error("Remote files require an active snapshot summary");
  }

  return {
    state,
    local,
    activeSnapshot: remote,
    comparisons:
      state === "conflict"
        ? buildComparisons(
            localFileDetails,
            localFiles,
            remoteFileDetails,
            remoteFiles
          )
        : [],
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
    manifest.snapshot.version !== snapshot.version ||
    manifest.snapshot.objectId !== objectId ||
    manifest.snapshot.shop !== shop
  ) {
    throw new Error("Active snapshot manifest does not belong to the game");
  }
};

export const loadCloudSaveV2FileDetails = async (
  input: LoadCloudSaveV2FileDetailsInput,
  getActiveManifest: (
    snapshot: RemoteSnapshotSummary
  ) => Promise<RestoreManifestResponse>
): Promise<CloudSaveV2FileDetails> => {
  if (!input.activeSnapshot) {
    return buildCloudSaveV2FileDetails({
      ...input,
      remoteVariants: [],
      remoteFiles: [],
    });
  }
  const manifest = await getActiveManifest(input.activeSnapshot);
  validateManifestOwnership(
    manifest,
    input.activeSnapshot,
    input.objectId,
    input.shop
  );
  return buildCloudSaveV2FileDetails({
    ...input,
    remoteVariants: manifest.variants,
    remoteFiles: manifest.files,
  });
};
