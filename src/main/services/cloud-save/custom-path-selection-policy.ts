import { canSelectCloudSaveCustomFile } from "../../../shared/cloud-save-emulator-provider.js";
import type { GameShop, SnapshotFile, UserLocationCoverage } from "@types";

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

export const assertCloudSaveCustomPathKindAllowed = (
  kind: "file" | "dir",
  shop: GameShop,
  platform?: string | null
) => {
  if (kind === "file" && !canSelectCloudSaveCustomFile(shop, platform)) {
    throw new Error("cloud_save_custom_path_file_not_supported");
  }
};
