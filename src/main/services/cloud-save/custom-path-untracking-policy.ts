export const executeCloudSaveCustomPathUntracking = async ({
  publishRemoval,
  removeBinding,
  dismissPendingApproval,
}: {
  publishRemoval: () => Promise<void>;
  removeBinding: () => Promise<void>;
  dismissPendingApproval: () => void;
}) => {
  await publishRemoval();
  try {
    await removeBinding();
  } catch (error) {
    throw new Error("cloud_save_custom_path_local_cleanup_failed", {
      cause: error,
    });
  }
  dismissPendingApproval();
};
