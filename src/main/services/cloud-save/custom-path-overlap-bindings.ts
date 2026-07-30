import type {
  CheckCloudSaveCustomPathOverlapResult,
  CloudSaveCustomPath,
  CloudSaveCustomPathBindings,
  CloudSavePathContext,
  CloudSaveRule,
  GameShop,
  RestoreManifestFile,
} from "@types";

export interface CloudSaveCustomPathOverlapOptions {
  objectId: string;
  shop: GameShop;
  selectedPath: string;
  pathContext: CloudSavePathContext;
  approvedRules: CloudSaveRule[];
  customPaths: CloudSaveCustomPath[];
  currentRawPath?: string;
  remoteRelativePaths?: string[];
}

export type CloudSaveCustomPathOverlapChecker = (
  options: CloudSaveCustomPathOverlapOptions
) => CheckCloudSaveCustomPathOverlapResult;

const unresolvedReason = (result: CheckCloudSaveCustomPathOverlapResult) =>
  result.reason === "custom-location-overlap"
    ? ("custom-location-overlap" as const)
    : ("mapped-location-overlap" as const);

export const partitionCloudSaveCustomPathBindingsByOverlap = (
  {
    objectId,
    shop,
    pathContext,
    bindings,
    approvedRules,
    remoteFiles,
  }: {
    objectId: string;
    shop: GameShop;
    pathContext: CloudSavePathContext;
    bindings: CloudSaveCustomPathBindings;
    approvedRules: CloudSaveRule[];
    remoteFiles: RestoreManifestFile[];
  },
  overlapChecker: CloudSaveCustomPathOverlapChecker
): CloudSaveCustomPathBindings => {
  const remoteFilesByRawPath = new Map<string, string[]>();
  for (const file of remoteFiles) {
    const paths = remoteFilesByRawPath.get(file.rawPath) ?? [];
    paths.push(file.relativePath);
    remoteFilesByRawPath.set(file.rawPath, paths);
  }

  const ready: CloudSaveCustomPath[] = [];
  const unresolved = [...bindings.unresolved];
  for (const binding of bindings.ready) {
    const result = overlapChecker({
      objectId,
      shop,
      selectedPath: binding.path,
      pathContext,
      approvedRules,
      customPaths: bindings.ready,
      currentRawPath: binding.rawPath,
      remoteRelativePaths: remoteFilesByRawPath.get(binding.rawPath) ?? [],
    });
    if (!result.hasOverlap) {
      ready.push(binding);
      continue;
    }

    unresolved.push({
      rawPath: binding.rawPath,
      pathHint: binding.path,
      state: "needs-confirmation",
      reason: unresolvedReason(result),
      registered: true,
    });
  }

  return { ready, unresolved };
};
