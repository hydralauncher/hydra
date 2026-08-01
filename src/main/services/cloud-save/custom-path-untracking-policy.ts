export const executeCloudSaveCustomPathUntracking = async ({
  ignore,
  dismissPendingApproval,
}: {
  ignore: () => Promise<void>;
  dismissPendingApproval: () => void;
}) => {
  await ignore();
  dismissPendingApproval();
};
