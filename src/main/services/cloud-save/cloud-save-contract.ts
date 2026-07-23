import type { UserVariantSnapshotFile } from "@types";

export const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const HASH_PATTERN = /^[a-f0-9]{64}$/;

export const validateUserVariantSnapshotFile = (
  value: unknown
): UserVariantSnapshotFile => {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid Cloud Save logical file");
  }
  const file = value as Record<string, unknown>;
  const locator = file.locator as Record<string, unknown> | undefined;
  const bindings = locator?.bindings as Record<string, unknown> | undefined;
  const storeUser = bindings?.storeUser as Record<string, unknown> | undefined;
  const relativePath = file.relativePath;
  if (
    !isNonEmptyString(file.logicalFileId) ||
    !HASH_PATTERN.test(file.logicalFileId) ||
    !isNonEmptyString(file.variantId) ||
    !HASH_PATTERN.test(file.variantId) ||
    !isNonEmptyString(file.ruleId) ||
    !HASH_PATTERN.test(file.ruleId) ||
    !isNonEmptyString(relativePath) ||
    relativePath.includes("\\") ||
    relativePath.startsWith("/") ||
    /^[A-Za-z]:/.test(relativePath) ||
    relativePath
      .split("/")
      .some((part) => !part || part === "." || part === "..") ||
    !isNonEmptyString(file.contentHash) ||
    !HASH_PATTERN.test(file.contentHash) ||
    typeof file.sizeBytes !== "number" ||
    !Number.isSafeInteger(file.sizeBytes) ||
    file.sizeBytes < 0 ||
    !locator ||
    locator.version !== 1 ||
    locator.ruleId !== file.ruleId ||
    !isNonEmptyString(locator.rawRule) ||
    !isNonEmptyString(locator.ruleSource) ||
    !isNonEmptyString(locator.rootKind) ||
    (locator.targetSemantics !== "single-file" &&
      locator.targetSemantics !== "directory-tree" &&
      locator.targetSemantics !== "glob-set") ||
    !bindings ||
    !isNonEmptyString(bindings.store) ||
    !isNonEmptyString(bindings.storeGameId) ||
    !storeUser ||
    (storeUser.kind !== "validated-account" &&
      storeUser.kind !== "opaque-folder") ||
    !isNonEmptyString(storeUser.store) ||
    storeUser.store !== bindings.store ||
    !isNonEmptyString(storeUser.concreteFolderId) ||
    storeUser.concreteFolderId.includes("/") ||
    storeUser.concreteFolderId.includes("\\") ||
    storeUser.concreteFolderId === "." ||
    storeUser.concreteFolderId === ".." ||
    (storeUser.kind === "validated-account" &&
      (!isNonEmptyString(storeUser.steamId64) ||
        !/^\d{17}$/.test(storeUser.steamId64) ||
        !isNonEmptyString(storeUser.accountId32) ||
        !/^\d{1,10}$/.test(storeUser.accountId32)))
  ) {
    throw new Error("Invalid Cloud Save logical file");
  }
  return value as UserVariantSnapshotFile;
};

export const validateUniqueLogicalFiles = (value: unknown) => {
  if (!Array.isArray(value)) throw new Error("Invalid Cloud Save file list");
  const ids = new Set<string>();
  return value.map((item) => {
    const file = validateUserVariantSnapshotFile(item);
    if (ids.has(file.logicalFileId)) {
      throw new Error("Duplicate Cloud Save logical file ID");
    }
    ids.add(file.logicalFileId);
    return file;
  });
};
