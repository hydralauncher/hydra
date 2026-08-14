import type { CloudSaveCustomPathOverlapReason } from "@types";

export const getCloudSaveCustomPathOverlapErrorCode = (
  reason: CloudSaveCustomPathOverlapReason | undefined
) => {
  if (reason === "custom-location-overlap") {
    return "cloud_save_custom_path_custom_location_overlap";
  }

  if (reason === "remote-target-mapped") {
    return "cloud_save_custom_path_remote_target_overlap";
  }

  return "cloud_save_custom_path_mapped_location_overlap";
};
