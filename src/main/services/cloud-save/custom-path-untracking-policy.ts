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
  await removeBinding();
  dismissPendingApproval();
};
