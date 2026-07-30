import type {
  CloudSaveCustomPathApproval,
  CloudSaveModalSyncResult,
  CloudSaveSyncTrigger,
  SyncGameCloudSaveResult,
} from "@types";

export interface CloudSaveModalSyncFlowDependencies<TContext> {
  confirmApproval: (approvalId: string) => Promise<void>;
  getContext: () => Promise<TContext>;
  createApproval: (
    context: TContext,
    preserveApprovalId: string | null
  ) => Promise<CloudSaveCustomPathApproval | null>;
  completeApproval: (approvalId: string) => Promise<void>;
  sync: (
    trigger: Extract<CloudSaveSyncTrigger, "custom-path-rebind" | "manual">,
    context: TContext
  ) => Promise<SyncGameCloudSaveResult>;
}

export const runCloudSaveModalSyncFlow = async <TContext>(
  approvalId: string | null,
  dependencies: CloudSaveModalSyncFlowDependencies<TContext>
): Promise<CloudSaveModalSyncResult> => {
  if (approvalId) {
    await dependencies.confirmApproval(approvalId);
  }

  let context = await dependencies.getContext();
  const pendingApproval = await dependencies.createApproval(
    context,
    approvalId
  );
  if (pendingApproval) {
    return {
      status: "approval-required",
      approval: pendingApproval,
    };
  }

  if (approvalId) {
    const restoreResult = await dependencies.sync(
      "custom-path-rebind",
      context
    );
    if (restoreResult.finalState === "conflict") {
      await dependencies.completeApproval(approvalId);
      return { status: "completed", result: restoreResult };
    }

    context = await dependencies.getContext();
    const approvalAfterRestore = await dependencies.createApproval(
      context,
      approvalId
    );
    if (approvalAfterRestore) {
      return {
        status: "approval-required",
        approval: approvalAfterRestore,
      };
    }
  }

  const result = await dependencies.sync("manual", context);
  if (approvalId) {
    await dependencies.completeApproval(approvalId);
  }
  return {
    status: "completed",
    result,
  };
};
