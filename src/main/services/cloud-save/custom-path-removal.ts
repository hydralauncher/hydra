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
