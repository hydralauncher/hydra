import type { analyzeCloudSaveState } from "../analyze-cloud-save-state.js";

type Analysis = Awaited<ReturnType<typeof analyzeCloudSaveState>>;

export const firstSyncRestoreArguments = (
  analysis: Pick<Analysis, "merge" | "safeMissingEmulatorRestoreEntryIds">,
  assertEnvironmentCurrent?: () => Promise<void>
) =>
  [
    analysis.merge.restoreEntryIds,
    true,
    analysis.merge.unresolvedRemoteEntryIds,
    assertEnvironmentCurrent,
    analysis.safeMissingEmulatorRestoreEntryIds,
  ] as const;
