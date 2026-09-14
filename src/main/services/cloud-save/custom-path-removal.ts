import type {
  RestoreManifestResponse,
  SnapshotFile,
  SnapshotVariant,
} from "@types";

export interface CloudSaveCustomPathRemovalProposal {
  changed: boolean;
  customPathRawPaths: string[];
  variants: SnapshotVariant[];
  files: SnapshotFile[];
}

export type CloudSaveCustomPathRemoteRemovalResult =
  | "unchanged"
  | "snapshot-updated"
  | "snapshot-deleted";

export const executeCloudSaveCustomPathRemoteRemoval = async ({
  proposal,
  updateSnapshot,
  deleteSnapshot,
}: {
  proposal: CloudSaveCustomPathRemovalProposal;
  updateSnapshot: () => Promise<void>;
  deleteSnapshot: () => Promise<void>;
}): Promise<CloudSaveCustomPathRemoteRemovalResult> => {
  if (!proposal.changed) return "unchanged";

  if (proposal.files.length === 0 && proposal.variants.length > 0) {
    throw new Error("cloud_save_custom_path_removal_invalid_empty_snapshot");
  }

  if (proposal.files.length === 0 && proposal.customPathRawPaths.length === 0) {
    await deleteSnapshot();
    return "snapshot-deleted";
  }

  await updateSnapshot();
  return "snapshot-updated";
};

export const buildCloudSaveCustomPathRemovalProposal = (
  manifest: Pick<
    RestoreManifestResponse,
    "customPathRawPaths" | "variants" | "files"
  >,
  rawPath: string
): CloudSaveCustomPathRemovalProposal => {
  if (!manifest.customPathRawPaths.includes(rawPath)) {
    return {
      changed: false,
      customPathRawPaths: manifest.customPathRawPaths,
      variants: manifest.variants,
      files: manifest.files,
    };
  }

  const customPathRawPaths = manifest.customPathRawPaths.filter(
    (candidate) => candidate !== rawPath
  );
  const files = manifest.files.filter((file) => file.rawPath !== rawPath);
  const usedVariantIds = new Set(files.map(({ variantId }) => variantId));
  const variants = manifest.variants.filter(({ variantId }) =>
    usedVariantIds.has(variantId)
  );

  return { changed: true, customPathRawPaths, variants, files };
};
