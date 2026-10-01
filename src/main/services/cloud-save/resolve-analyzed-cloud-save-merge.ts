import type { CloudSaveConflictResolution, CloudSaveMergeResult } from "@types";

import type { analyzeCloudSaveState } from "./analyze-cloud-save-state.js";
import { mergeUserVariantSnapshots } from "./merge-user-variant-snapshots.js";

type CloudSaveAnalysis = Awaited<ReturnType<typeof analyzeCloudSaveState>>;
type RemoteManifest = NonNullable<CloudSaveAnalysis["remoteManifest"]>;
type ResolvableCloudSaveAnalysis = Pick<
  CloudSaveAnalysis,
  | "merge"
  | "localSnapshotContext"
  | "anchor"
  | "syncDirection"
  | "pendingCustomPathRawPaths"
  | "installationOwnedCustomPathRawPaths"
> & {
  remoteManifest: Pick<RemoteManifest, "variants" | "files"> | null;
};

export const resolveAnalyzedCloudSaveMerge = (
  analysis: ResolvableCloudSaveAnalysis,
  resolution?: CloudSaveConflictResolution
): CloudSaveMergeResult => {
  if (!resolution) return analysis.merge;
  if (analysis.merge.conflicts.length === 0) {
    throw new Error("cloud_save_conflict_no_longer_exists");
  }
  const resolutions = new Map(
    analysis.merge.conflicts.map((conflict) => [conflict.entryId, resolution])
  );
  return mergeUserVariantSnapshots({
    local: analysis.localSnapshotContext,
    remoteVariants: analysis.remoteManifest?.variants ?? [],
    remoteFiles: analysis.remoteManifest?.files ?? [],
    base: analysis.anchor,
    direction: analysis.syncDirection,
    resolutions,
    treatLocalAsNewRawPaths: new Set(analysis.pendingCustomPathRawPaths),
    preserveLocalMissingRawPaths: new Set(
      analysis.installationOwnedCustomPathRawPaths
    ),
  });
};
