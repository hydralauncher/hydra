import type { CloudSaveV2FileDetails } from "@types";

interface CloudSaveFileBrowserOperationState {
  isAddingCustomPath: boolean;
  isRebindingCustomPath: boolean;
  isRemovingCustomPath: boolean;
  isDeletingCloudSave: boolean;
  isBindingRpcs3Profile?: boolean;
  isLoading: boolean;
  isGameRunning: boolean;
  isSyncing: boolean;
}

export const shouldShowRpcs3ProfileWarning = (
  profile: CloudSaveV2FileDetails["rpcs3Profile"]
) =>
  Boolean(
    profile?.cloudProfileIds.length &&
      !profile.cloudProfileIds.includes(profile.linkedCloudProfileId ?? "")
  );

export const getCloudSaveFileBrowserOperationPolicy = ({
  isAddingCustomPath,
  isRebindingCustomPath,
  isRemovingCustomPath,
  isDeletingCloudSave,
  isBindingRpcs3Profile = false,
  isLoading,
  isGameRunning,
  isSyncing,
}: CloudSaveFileBrowserOperationState) => ({
  actionsAreDisabled:
    isAddingCustomPath ||
    isRebindingCustomPath ||
    isRemovingCustomPath ||
    isDeletingCloudSave ||
    isBindingRpcs3Profile ||
    isLoading ||
    isGameRunning ||
    isSyncing,
  closeIsBlocked: isDeletingCloudSave || isBindingRpcs3Profile,
});
