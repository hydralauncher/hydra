interface CloudSaveFileBrowserOperationState {
  isAddingCustomPath: boolean;
  isRebindingCustomPath: boolean;
  isRemovingCustomPath: boolean;
  isDeletingCloudSave: boolean;
  isLoading: boolean;
  isGameRunning: boolean;
  isSyncing: boolean;
}

export const getCloudSaveFileBrowserOperationPolicy = ({
  isAddingCustomPath,
  isRebindingCustomPath,
  isRemovingCustomPath,
  isDeletingCloudSave,
  isLoading,
  isGameRunning,
  isSyncing,
}: CloudSaveFileBrowserOperationState) => ({
  actionsAreDisabled:
    isAddingCustomPath ||
    isRebindingCustomPath ||
    isRemovingCustomPath ||
    isDeletingCloudSave ||
    isLoading ||
    isGameRunning ||
    isSyncing,
  closeIsBlocked: isDeletingCloudSave,
});
