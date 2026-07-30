import type {
  CloudSaveFileIdentity,
  GameShop,
  RemoteSnapshotSummary,
  RestoreManifestResponse,
  SnapshotFile,
  SnapshotVariant,
} from "@types";

export const CLOUD_SAVE_HASH_PATTERN = /^[a-f0-9]{64}$/;

export const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export const cloudSaveFileKey = ({
  variantId,
  rawPath,
  relativePath,
}: CloudSaveFileIdentity) => JSON.stringify([variantId, rawPath, relativePath]);

const isSafeRelativePath = (value: unknown): value is string =>
  isNonEmptyString(value) &&
  !value.includes("\\") &&
  !value.startsWith("/") &&
  !/^[A-Za-z]:/.test(value) &&
  !value
    .split("/")
    .some((segment) => !segment || segment === "." || segment === "..");

const isSafeFolderSegment = (value: unknown): value is string =>
  isNonEmptyString(value) &&
  value.length <= 255 &&
  value !== "." &&
  value !== ".." &&
  !value.includes("/") &&
  !value.includes("\\") &&
  !value.includes("\0");

const hasOnlyKeys = (
  value: Record<string, unknown>,
  expected: readonly string[]
) =>
  Object.keys(value).every((key) => expected.includes(key)) &&
  expected.every((key) => key in value);

export const validateSnapshotVariant = (value: unknown): SnapshotVariant => {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid Cloud Save snapshot variant");
  }
  const variant = value as Record<string, unknown>;
  if (
    !isNonEmptyString(variant.variantId) ||
    !CLOUD_SAVE_HASH_PATTERN.test(variant.variantId)
  ) {
    throw new Error("Invalid Cloud Save snapshot variant");
  }
  if (
    variant.kind === "default" &&
    hasOnlyKeys(variant, ["variantId", "kind"])
  ) {
    return value as SnapshotVariant;
  }
  if (
    variant.kind === "steam-account" &&
    hasOnlyKeys(variant, ["variantId", "kind", "steamId64"]) &&
    typeof variant.steamId64 === "string" &&
    /^\d{17}$/.test(variant.steamId64)
  ) {
    return value as SnapshotVariant;
  }
  if (
    variant.kind === "opaque-folder" &&
    hasOnlyKeys(variant, ["variantId", "kind", "concreteFolderId"]) &&
    isSafeFolderSegment(variant.concreteFolderId)
  ) {
    return value as SnapshotVariant;
  }
  throw new Error("Invalid Cloud Save snapshot variant");
};

export const validateSnapshotVariants = (
  value: unknown,
  shop?: GameShop
): SnapshotVariant[] => {
  if (!Array.isArray(value)) throw new Error("Invalid Cloud Save variants");
  const variants = value.map(validateSnapshotVariant);
  const ids = new Set<string>();
  let defaultCount = 0;
  for (const variant of variants) {
    if (ids.has(variant.variantId)) {
      throw new Error("Duplicate Cloud Save variant");
    }
    ids.add(variant.variantId);
    if (variant.kind === "default") defaultCount += 1;
    if (variant.kind === "steam-account" && shop && shop !== "steam") {
      throw new Error("Steam Cloud Save variant used by a non-Steam game");
    }
  }
  if (defaultCount > 1) throw new Error("Duplicate default Cloud Save variant");
  return variants;
};

export const validateSnapshotFile = (value: unknown): SnapshotFile => {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid Cloud Save snapshot file");
  }
  const file = value as Record<string, unknown>;
  if (
    !hasOnlyKeys(file, [
      "variantId",
      "rawPath",
      "relativePath",
      "hash",
      "sizeBytes",
      "lastModifiedAt",
    ]) ||
    !isNonEmptyString(file.variantId) ||
    !CLOUD_SAVE_HASH_PATTERN.test(file.variantId) ||
    !isNonEmptyString(file.rawPath) ||
    file.rawPath.includes("\\") ||
    !isSafeRelativePath(file.relativePath) ||
    !isNonEmptyString(file.hash) ||
    !CLOUD_SAVE_HASH_PATTERN.test(file.hash) ||
    typeof file.sizeBytes !== "number" ||
    !Number.isSafeInteger(file.sizeBytes) ||
    file.sizeBytes < 0 ||
    !isNonEmptyString(file.lastModifiedAt) ||
    !Number.isFinite(Date.parse(file.lastModifiedAt))
  ) {
    throw new Error("Invalid Cloud Save snapshot file");
  }
  return value as SnapshotFile;
};

export const validateSnapshotFiles = (
  value: unknown,
  variants?: SnapshotVariant[]
): SnapshotFile[] => {
  if (!Array.isArray(value)) throw new Error("Invalid Cloud Save file list");
  const files = value.map(validateSnapshotFile);
  const keys = new Set<string>();
  const variantIds = variants
    ? new Set(variants.map((variant) => variant.variantId))
    : null;
  const usedVariants = new Set<string>();
  const sizeByHash = new Map<string, number>();
  for (const file of files) {
    const key = cloudSaveFileKey(file);
    if (keys.has(key)) throw new Error("Duplicate Cloud Save file identity");
    keys.add(key);
    if (variantIds && !variantIds.has(file.variantId)) {
      throw new Error("Cloud Save file references an unknown variant");
    }
    usedVariants.add(file.variantId);
    const knownSize = sizeByHash.get(file.hash);
    if (knownSize !== undefined && knownSize !== file.sizeBytes) {
      throw new Error("Cloud Save hash is associated with divergent sizes");
    }
    sizeByHash.set(file.hash, file.sizeBytes);
  }
  if (
    variants &&
    variants.some((variant) => !usedVariants.has(variant.variantId))
  ) {
    throw new Error("Cloud Save manifest contains an unused variant");
  }
  return files;
};

export const validateRemoteSnapshotSummary = (
  value: unknown
): RemoteSnapshotSummary => {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid Cloud Save snapshot summary");
  }
  const snapshot = value as Record<string, unknown>;
  if (
    !hasOnlyKeys(snapshot, [
      "id",
      "version",
      "createdAt",
      "updatedAt",
      "fileCount",
      "totalSizeBytes",
      "aggregateHash",
    ]) ||
    !isNonEmptyString(snapshot.id) ||
    typeof snapshot.version !== "number" ||
    !Number.isSafeInteger(snapshot.version) ||
    snapshot.version < 1 ||
    !isNonEmptyString(snapshot.createdAt) ||
    !Number.isFinite(Date.parse(snapshot.createdAt)) ||
    !isNonEmptyString(snapshot.updatedAt) ||
    !Number.isFinite(Date.parse(snapshot.updatedAt)) ||
    typeof snapshot.fileCount !== "number" ||
    !Number.isSafeInteger(snapshot.fileCount) ||
    snapshot.fileCount < 1 ||
    typeof snapshot.totalSizeBytes !== "number" ||
    !Number.isSafeInteger(snapshot.totalSizeBytes) ||
    snapshot.totalSizeBytes < 0 ||
    !isNonEmptyString(snapshot.aggregateHash) ||
    !CLOUD_SAVE_HASH_PATTERN.test(snapshot.aggregateHash)
  ) {
    throw new Error("Invalid Cloud Save snapshot summary");
  }
  return value as RemoteSnapshotSummary;
};

export const validateRestoreManifest = (
  value: unknown
): RestoreManifestResponse => {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid restore manifest response");
  }
  const response = value as Record<string, unknown>;
  if (!hasOnlyKeys(response, ["snapshot", "variants", "files"])) {
    throw new Error("Invalid restore manifest response");
  }
  const snapshot = response.snapshot as Record<string, unknown> | undefined;
  if (
    !snapshot ||
    !hasOnlyKeys(snapshot, ["id", "version", "shop", "objectId"]) ||
    !isNonEmptyString(snapshot.id) ||
    typeof snapshot.version !== "number" ||
    !Number.isSafeInteger(snapshot.version) ||
    snapshot.version < 1 ||
    (snapshot.shop !== "steam" && snapshot.shop !== "launchbox") ||
    !isNonEmptyString(snapshot.objectId)
  ) {
    throw new Error("Invalid restore manifest snapshot");
  }
  const shop = snapshot.shop as GameShop;
  const variants = validateSnapshotVariants(response.variants, shop);
  const files = validateSnapshotFiles(response.files, variants);
  return {
    snapshot: {
      id: snapshot.id,
      version: snapshot.version,
      shop,
      objectId: snapshot.objectId,
    },
    variants,
    files,
  };
};
