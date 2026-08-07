import type { UserLocationCoverage } from "@types";

interface CloudSaveSyncPartialAfterApplyInput {
  coverage: UserLocationCoverage[];
  unresolvedRemoteEntryIds: string[];
  restorePartial?: boolean;
  hasDeferredLocalChanges?: boolean;
}

export const isCloudSaveSyncPartialAfterApply = ({
  coverage,
  unresolvedRemoteEntryIds,
  restorePartial = false,
  hasDeferredLocalChanges = false,
}: CloudSaveSyncPartialAfterApplyInput) =>
  coverage.some(
    (item) =>
      item.outcome !== "foreign-environment" &&
      (!item.enumeratedCompletely ||
        item.outcome === "failed" ||
        item.outcome === "partial" ||
        item.outcome === "unresolved")
  ) ||
  unresolvedRemoteEntryIds.length > 0 ||
  restorePartial ||
  hasDeferredLocalChanges;
