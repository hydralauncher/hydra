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
