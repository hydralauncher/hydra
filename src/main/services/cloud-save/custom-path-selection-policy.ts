import type { SnapshotFile, UserLocationCoverage } from "@types";

export type CloudSaveCustomPathSelectionFailure =
  | "empty"
  | "environment-unavailable"
  | "foreign-environment"
  | "unreadable";

export const hasEligibleCloudSaveCustomPathFiles = (
  files: Pick<SnapshotFile, "rawPath">[],
  rawPath: string
) => files.some((file) => file.rawPath === rawPath);

export const getCloudSaveCustomPathSelectionFailure = (
  files: Pick<SnapshotFile, "rawPath">[],
  coverage: Pick<
    UserLocationCoverage,
    "rawPath" | "outcome" | "enumeratedCompletely"
  >[],
  rawPath: string
): CloudSaveCustomPathSelectionFailure | null => {
  if (hasEligibleCloudSaveCustomPathFiles(files, rawPath)) return null;

  const matchingCoverage = coverage.filter((item) => item.rawPath === rawPath);
  if (
    matchingCoverage.some(
      (item) =>
        item.outcome === "failed" ||
        item.outcome === "partial" ||
        (!item.enumeratedCompletely &&
          item.outcome !== "foreign-environment" &&
          item.outcome !== "unresolved")
    )
  ) {
    return "unreadable";
  }
  if (matchingCoverage.some((item) => item.outcome === "foreign-environment")) {
    return "foreign-environment";
  }
  if (matchingCoverage.some((item) => item.outcome === "unresolved")) {
    return "environment-unavailable";
  }

  return "empty";
};
