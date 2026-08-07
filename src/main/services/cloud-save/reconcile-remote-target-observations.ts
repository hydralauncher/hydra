import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";

import type {
  BuildSnapshotAggregateHashInput,
  LocalGameSnapshotContext,
  ResolveRestoreTargetsResult,
  RestoreManifestFile,
  SnapshotVariant,
  UserLocationCoverage,
} from "@types";

import { cloudSaveFileKey } from "./cloud-save-contract.js";
import { areSnapshotVariantsEqual } from "./snapshot-variant.js";

const stableId = (parts: string[]) => {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(String(Buffer.byteLength(part)));
    hash.update(":");
    hash.update(part);
  }
  return hash.digest("hex");
};

const canonicalOrLexicalPath = (value: string) => {
  const resolved = path.resolve(value);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
};

const pathKey = (value: string, context: LocalGameSnapshotContext) => {
  const canonical = canonicalOrLexicalPath(value);
  const normalized = canonical.replaceAll("\\", "/").normalize("NFC");
  const caseSensitive =
    context.pathContext.platform === "linux" &&
    !context.pathContext.executablePath?.toLowerCase().endsWith(".exe");
  return caseSensitive ? normalized : normalized.toLowerCase();
};

const coverageFor = (
  file: RestoreManifestFile,
  outcome: UserLocationCoverage["outcome"],
  enumeratedCompletely: boolean,
  warningCodes: string[] = []
): UserLocationCoverage => ({
  candidateId: stableId([
    "remote-target",
    file.variantId,
    file.rawPath,
    file.relativePath,
    outcome,
  ]),
  ruleId: stableId(["remote-target-rule", file.rawPath]),
  variantId: file.variantId,
  rawPath: file.rawPath,
  relativePath: file.relativePath,
  selectedRoot: true,
  authority: "exact",
  outcome,
  enumeratedCompletely,
  warningCodes,
});

const variantUserSegment = (variant: SnapshotVariant) => {
  if (variant.kind === "opaque-folder") return variant.concreteFolderId;
  if (variant.kind === "steam-account") return variant.steamId64;
  return "__unbound__";
};

export const reconcileRemoteTargetObservations = (
  local: LocalGameSnapshotContext,
  remoteVariants: SnapshotVariant[],
  remoteFiles: RestoreManifestFile[],
  resolution: ResolveRestoreTargetsResult,
  buildAggregateHash: (input: BuildSnapshotAggregateHashInput) => string
): LocalGameSnapshotContext => {
  const remoteById = new Map(
    remoteFiles.map((file) => [cloudSaveFileKey(file), file])
  );
  const localIds = new Set(local.files.map(cloudSaveFileKey));
  const sourceByPath = new Map(
    local.sourceFiles.map((file) => [pathKey(file.absolutePath, local), file])
  );
  const files = [...local.files];
  const sourceFiles = [...local.sourceFiles];
  const coverage = [...local.coverage];
  const variantById = new Map(
    local.variants.map((variant) => [variant.variantId, variant])
  );
  for (const variant of remoteVariants) {
    const existing = variantById.get(variant.variantId);
    if (existing && !areSnapshotVariantsEqual(existing, variant)) {
      throw new Error("Divergent Cloud Save metadata for the same variant");
    }
    variantById.set(variant.variantId, variant);
  }

  for (const blocked of resolution.blocked) {
    if (localIds.has(cloudSaveFileKey(blocked))) continue;
    coverage.push(coverageFor(blocked, "partial", false, [blocked.reason]));
  }
  for (const deferred of resolution.deferred) {
    if (localIds.has(cloudSaveFileKey(deferred))) continue;
    coverage.push(
      coverageFor(deferred, "foreign-environment", true, [deferred.reason])
    );
  }

  for (const target of resolution.actions) {
    const entryId = cloudSaveFileKey(target);
    if (localIds.has(entryId)) continue;
    if (
      !target.observedHash ||
      target.observedSizeBytes === undefined ||
      !target.observedLastModifiedAt
    ) {
      continue;
    }

    const remote = remoteById.get(entryId);
    const variant = variantById.get(target.variantId);
    if (!remote || !variant) {
      throw new Error("Resolved Cloud Save target is missing remote metadata");
    }
    const canonicalPath = pathKey(target.targetPath, local);
    const existingSource = sourceByPath.get(canonicalPath);
    if (existingSource && cloudSaveFileKey(existingSource) !== entryId) {
      coverage.push(
        coverageFor(remote, "partial", false, [
          "remote-target-identity-overlap",
        ])
      );
      continue;
    }

    const observed = {
      variantId: remote.variantId,
      rawPath: remote.rawPath,
      relativePath: remote.relativePath,
      hash: target.observedHash,
      sizeBytes: target.observedSizeBytes,
      lastModifiedAt: target.observedLastModifiedAt,
    };
    const ruleId = stableId(["remote-target-rule", remote.rawPath]);
    const source = {
      ...observed,
      ruleId,
      absolutePath: target.targetPath,
      localBindings: {
        environmentId: local.environmentId,
        rootId: stableId([
          "remote-target-root",
          local.environmentId,
          target.restoreRootPath,
        ]),
        concreteUserSegment: variantUserSegment(variant),
        concretePath: target.restoreRootPath,
      },
      confidence: "exact" as const,
      provenance: [`remote-target:${ruleId}`],
    };
    files.push(observed);
    sourceFiles.push(source);
    coverage.push(coverageFor(remote, "scanned", true));
    localIds.add(entryId);
    sourceByPath.set(canonicalPath, source);
  }

  files.sort((left, right) =>
    cloudSaveFileKey(left).localeCompare(cloudSaveFileKey(right))
  );
  sourceFiles.sort((left, right) =>
    cloudSaveFileKey(left).localeCompare(cloudSaveFileKey(right))
  );
  const usedVariantIds = new Set(files.map((file) => file.variantId));
  const variants = [...variantById.values()]
    .filter((variant) => usedVariantIds.has(variant.variantId))
    .sort((left, right) => left.variantId.localeCompare(right.variantId));
  const totalSizeBytes = files.reduce(
    (total, file) => total + file.sizeBytes,
    0
  );
  const aggregateHash = buildAggregateHash({ variants, files });

  return {
    ...local,
    coverage,
    variants,
    files,
    sourceFiles,
    fileCount: files.length,
    totalSizeBytes,
    aggregateHash,
  };
};
