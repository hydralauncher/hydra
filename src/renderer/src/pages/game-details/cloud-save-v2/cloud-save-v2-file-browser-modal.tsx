import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  ArrowClockwiseIcon,
  CircleNotchIcon,
  CloudIcon,
  MonitorIcon,
  PlusIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { TrashIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";

import type {
  CloudSaveState,
  CloudSaveSyncProgressPayload,
  CloudSaveV2FileDetails,
  GameShop,
  SyncGameCloudSaveResult,
} from "@types";
import { formatBytes } from "@shared";
import {
  Button,
  CheckboxField,
  ConfirmationModal,
  Modal,
} from "@renderer/components";
import { useToast } from "@renderer/hooks";

import {
  buildCloudSaveV2ComparisonTree,
  buildCloudSaveV2LocalFileTree,
  filterCloudSaveV2Comparisons,
  type CloudSaveV2FileTreeRoot,
} from "./cloud-save-v2-file-tree";
import { getCloudSaveFileBrowserOperationPolicy } from "./cloud-save-v2-file-browser-policy";
import { CloudSaveV2FileTreeView } from "./cloud-save-v2-file-tree-view";
import {
  getCloudSaveOperationPresentation,
  hasCloudSaveDataToDelete,
} from "./cloud-save-presentation";

const getCustomPathSelectionError = (error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("cloud_save_custom_path_empty")) {
    return "empty" as const;
  }
  if (message.includes("cloud_save_custom_path_environment_unavailable")) {
    return "environment" as const;
  }
  if (message.includes("cloud_save_custom_path_foreign_environment")) {
    return "wine-environment" as const;
  }
  if (message.includes("cloud_save_custom_path_unreadable")) {
    return "unreadable" as const;
  }
  if (message.includes("cloud_save_custom_path_custom_location_overlap")) {
    return "custom" as const;
  }
  if (message.includes("cloud_save_custom_path_mapped_location_overlap")) {
    return "mapped" as const;
  }
  if (message.includes("cloud_save_custom_path_remote_target_overlap")) {
    return "remote-target" as const;
  }
  return null;
};

const getCustomPathErrorTranslationKeys = (
  wasAdded: boolean,
  selectionError: ReturnType<typeof getCustomPathSelectionError>
) => {
  if (wasAdded) {
    return {
      title: "cloud_save_v2_custom_path_sync_error_title",
      description: "cloud_save_v2_custom_path_sync_error_description",
    };
  }
  if (selectionError === "empty") {
    return {
      title: "cloud_save_v2_custom_path_empty_error_title",
      description: "cloud_save_v2_custom_path_empty_error_description",
    };
  }
  if (selectionError === "mapped") {
    return {
      title: "cloud_save_v2_custom_path_mapped_overlap_error_title",
      description: "cloud_save_v2_custom_path_mapped_overlap_error_description",
    };
  }
  if (selectionError === "environment") {
    return {
      title: "cloud_save_v2_custom_path_environment_error_title",
      description: "cloud_save_v2_custom_path_environment_error_description",
    };
  }
  if (selectionError === "wine-environment") {
    return {
      title: "cloud_save_v2_custom_path_wine_environment_error_title",
      description:
        "cloud_save_v2_custom_path_wine_environment_error_description",
    };
  }
  if (selectionError === "unreadable") {
    return {
      title: "cloud_save_v2_custom_path_read_error_title",
      description: "cloud_save_v2_custom_path_read_error_description",
    };
  }
  if (selectionError === "custom") {
    return {
      title: "cloud_save_v2_custom_path_custom_overlap_error_title",
      description: "cloud_save_v2_custom_path_custom_overlap_error_description",
    };
  }
  if (selectionError === "remote-target") {
    return {
      title: "cloud_save_v2_custom_path_remote_target_overlap_error_title",
      description:
        "cloud_save_v2_custom_path_remote_target_overlap_error_description",
    };
  }
  return {
    title: "cloud_save_v2_custom_path_error_title",
    description: "cloud_save_v2_custom_path_error_description",
  };
};

interface CloudSaveV2FileBrowserModalProps {
  visible: boolean;
  objectId: string;
  shop: GameShop;
  overviewState: CloudSaveState | null;
  details: CloudSaveV2FileDetails | null;
  isLoading: boolean;
  hasError: boolean;
  isGameRunning: boolean;
  isSyncing: boolean;
  progress: CloudSaveSyncProgressPayload | null;
  onRetry: () => void | Promise<void>;
  onSyncAfterCustomPathAdded: () => Promise<SyncGameCloudSaveResult>;
  onRemoveTrackedCustomPath: (rawPath: string) => Promise<void>;
  onRequestCustomPathRebind: (rawPath: string) => Promise<void>;
  onClose: () => void;
}

interface CloudSaveV2FileContentProps {
  details: CloudSaveV2FileDetails;
  isConflict: boolean;
  comparisonRoots: CloudSaveV2FileTreeRoot[];
  localRoots: CloudSaveV2FileTreeRoot[];
  isLoading: boolean;
  actionsDisabled: boolean;
  addCustomPathButton: ReactNode;
  onRetry: () => void | Promise<void>;
  onOpenFolder: (path: string) => void;
  onRebindCustomPath: (rawPath: string) => void;
  onRemoveCustomPath: (rawPath: string) => void;
}

function CloudSaveV2FileContent({
  details,
  isConflict,
  comparisonRoots,
  localRoots,
  isLoading,
  actionsDisabled,
  addCustomPathButton,
  onRetry,
  onOpenFolder,
  onRebindCustomPath,
  onRemoveCustomPath,
}: Readonly<CloudSaveV2FileContentProps>) {
  const { t } = useTranslation("game_details");
  const [isFileListScrolled, setIsFileListScrolled] = useState(false);

  if (isConflict && details.activeSnapshot) {
    return (
      <div
        className="cloud-save-v2__browser-table-scroll"
        onScroll={(event) =>
          setIsFileListScrolled(event.currentTarget.scrollTop > 0)
        }
      >
        <div
          className={`cloud-save-v2__browser-scroll-shadow cloud-save-v2__browser-scroll-shadow--below-header ${isFileListScrolled ? "cloud-save-v2__browser-scroll-shadow--visible" : ""}`}
        />
        <div className="cloud-save-v2__browser-diff-table">
          <div className="cloud-save-v2__browser-diff-header">
            <span />
            <div className="cloud-save-v2__browser-diff-source-header">
              <MonitorIcon
                size={20}
                className="cloud-save-v2__browser-monitor-icon"
              />
              <strong>{t("cloud_save_v2_local_files")}</strong>
              <span>
                {t("cloud_save_v2_source_summary", {
                  count: details.local.fileCount,
                  size: formatBytes(details.local.totalSizeBytes),
                })}
              </span>
            </div>
            <strong className="cloud-save-v2__browser-diff-status-header">
              {t("cloud_save_v2_status")}
            </strong>
            <div className="cloud-save-v2__browser-diff-source-header">
              <CloudIcon size={20} />
              <strong>{t("cloud_save_v2_remote_files")}</strong>
              <span>
                {t("cloud_save_v2_source_summary", {
                  count: details.activeSnapshot.fileCount,
                  size: formatBytes(details.activeSnapshot.totalSizeBytes),
                })}
              </span>
            </div>
          </div>
          {comparisonRoots.length > 0 ? (
            <CloudSaveV2FileTreeView
              roots={comparisonRoots}
              mode="comparison"
              onOpenFolder={onOpenFolder}
              onRebindCustomPath={onRebindCustomPath}
              onRemoveCustomPath={onRemoveCustomPath}
              customPathActionsDisabled={actionsDisabled}
            />
          ) : (
            <p className="cloud-save-v2__browser-empty">
              {t("cloud_save_v2_no_visible_differences")}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (localRoots.length > 0) {
    return (
      <div
        className="cloud-save-v2__browser-local-tree"
        onScroll={(event) =>
          setIsFileListScrolled(event.currentTarget.scrollTop > 0)
        }
      >
        <div
          className={`cloud-save-v2__browser-scroll-shadow ${isFileListScrolled ? "cloud-save-v2__browser-scroll-shadow--visible" : ""}`}
        />
        <CloudSaveV2FileTreeView
          roots={localRoots}
          mode="local"
          onOpenFolder={onOpenFolder}
          onRebindCustomPath={onRebindCustomPath}
          onRemoveCustomPath={onRemoveCustomPath}
          customPathActionsDisabled={actionsDisabled}
        />
      </div>
    );
  }

  if (isConflict) {
    return (
      <p className="cloud-save-v2__browser-empty">
        {t("cloud_save_v2_no_local_files")}
      </p>
    );
  }

  return (
    <div className="cloud-save-v2__browser-empty cloud-save-v2__browser-empty--actions">
      <div className="cloud-save-v2__browser-empty-copy">
        <strong>{t("cloud_save_v2_no_local_files")}</strong>
        <span>{t("cloud_save_v2_no_local_files_description")}</span>
      </div>
      <div className="cloud-save-v2__browser-empty-actions">
        <Button disabled={actionsDisabled} onClick={() => void onRetry()}>
          {isLoading ? (
            <CircleNotchIcon className="cloud-save-v2__spinner" size={16} />
          ) : (
            <ArrowClockwiseIcon size={16} />
          )}
          <span>{t("cloud_save_v2_check_again")}</span>
        </Button>
        {addCustomPathButton}
      </div>
    </div>
  );
}

export function CloudSaveV2FileBrowserModal({
  visible,
  objectId,
  shop,
  overviewState,
  details,
  isLoading,
  hasError,
  isGameRunning,
  isSyncing,
  progress,
  onRetry,
  onSyncAfterCustomPathAdded,
  onRemoveTrackedCustomPath,
  onRequestCustomPathRebind,
  onClose,
}: Readonly<CloudSaveV2FileBrowserModalProps>) {
  const { t } = useTranslation("game_details");
  const { showErrorToast, showSuccessToast } = useToast();
  const [showOnlyChanged, setShowOnlyChanged] = useState(true);
  const [isAddingCustomPath, setIsAddingCustomPath] = useState(false);
  const [rebindingCustomPath, setRebindingCustomPath] = useState<string | null>(
    null
  );
  const [removingCustomPath, setRemovingCustomPath] = useState<string | null>(
    null
  );
  const [pendingCustomPathRemoval, setPendingCustomPathRemoval] = useState<
    string | null
  >(null);
  const [isDeleteConfirmationVisible, setIsDeleteConfirmationVisible] =
    useState(false);
  const [isDeletingCloudSave, setIsDeletingCloudSave] = useState(false);
  const isConflict = details?.state === "conflict";
  const titleIsConflict = isConflict || overviewState === "conflict";
  const visibleComparisons = useMemo(
    () =>
      filterCloudSaveV2Comparisons(details?.comparisons ?? [], showOnlyChanged),
    [details?.comparisons, showOnlyChanged]
  );
  const localRoots = useMemo(
    () =>
      buildCloudSaveV2LocalFileTree(
        details?.local.files ?? [],
        details?.customPaths ?? [],
        details?.unresolvedCustomPaths ?? [],
        details?.activeSnapshot?.files ?? []
      ),
    [
      details?.activeSnapshot?.files,
      details?.customPaths,
      details?.local.files,
      details?.unresolvedCustomPaths,
    ]
  );
  const comparisonRoots = useMemo(
    () =>
      buildCloudSaveV2ComparisonTree(
        visibleComparisons,
        details?.customPaths ?? [],
        details?.unresolvedCustomPaths ?? []
      ),
    [details?.customPaths, details?.unresolvedCustomPaths, visibleComparisons]
  );
  const comparisonCounts = useMemo(() => {
    const counts = {
      modified: 0,
      localOnly: 0,
      remoteOnly: 0,
      unchanged: 0,
    };

    for (const comparison of details?.comparisons ?? []) {
      if (comparison.status === "local-only") counts.localOnly += 1;
      else if (comparison.status === "remote-only") counts.remoteOnly += 1;
      else counts[comparison.status] += 1;
    }

    return counts;
  }, [details?.comparisons]);

  useEffect(() => {
    if (!visible) {
      setShowOnlyChanged(true);
      if (!removingCustomPath) setPendingCustomPathRemoval(null);
      if (!isDeletingCloudSave) setIsDeleteConfirmationVisible(false);
    }
  }, [isDeletingCloudSave, removingCustomPath, visible]);

  const showPathError = () => {
    showErrorToast(
      t("cloud_save_v2_path_unavailable_title"),
      t("cloud_save_v2_path_unavailable_description")
    );
  };

  const handleOpenFolder = async (path: string) => {
    try {
      const opened = await window.electron.openGameSaveFolder(
        shop,
        objectId,
        path
      );
      if (!opened) showPathError();
    } catch {
      showPathError();
    }
  };

  const handleAddCustomPath = async () => {
    setIsAddingCustomPath(true);
    let wasAdded = false;
    try {
      const result = await window.electron.selectCloudSaveCustomPath(
        objectId,
        shop
      );
      if (!result.canceled && result.customPath) {
        wasAdded = true;
        const syncResult = await onSyncAfterCustomPathAdded();
        if (syncResult.finalState === "conflict") {
          throw new Error("cloud_save_custom_path_sync_conflict");
        }
        showSuccessToast(t("cloud_save_v2_custom_path_added"));
      }
    } catch (error) {
      const selectionError = !wasAdded
        ? getCustomPathSelectionError(error)
        : null;
      const translationKeys = getCustomPathErrorTranslationKeys(
        wasAdded,
        selectionError
      );
      showErrorToast(t(translationKeys.title), t(translationKeys.description));
    } finally {
      setIsAddingCustomPath(false);
    }
  };

  const handleRemoveCustomPath = async () => {
    const rawPath = pendingCustomPathRemoval;
    if (!rawPath) return;

    setRemovingCustomPath(rawPath);
    setPendingCustomPathRemoval(null);
    try {
      await onRemoveTrackedCustomPath(rawPath);
      showSuccessToast(t("cloud_save_v2_custom_path_removed"));
    } catch (error) {
      const localCleanupFailed =
        error instanceof Error &&
        error.message.includes("cloud_save_custom_path_local_cleanup_failed");
      showErrorToast(
        t(
          localCleanupFailed
            ? "cloud_save_v2_custom_path_remove_local_error_title"
            : "cloud_save_v2_custom_path_remove_error_title"
        ),
        t(
          localCleanupFailed
            ? "cloud_save_v2_custom_path_remove_local_error_description"
            : "cloud_save_v2_custom_path_remove_error_description"
        )
      );
    } finally {
      setRemovingCustomPath(null);
    }
  };

  const handleRebindCustomPath = async (rawPath: string) => {
    setRebindingCustomPath(rawPath);
    try {
      await onRequestCustomPathRebind(rawPath);
    } catch {
      showErrorToast(
        t("cloud_save_v2_custom_path_rebind_error_title"),
        t("cloud_save_v2_custom_path_rebind_error_description")
      );
    } finally {
      setRebindingCustomPath(null);
    }
  };

  const handleDeleteCloudSave = async () => {
    if (isDeletingCloudSave || !hasSaveData) return;

    setIsDeletingCloudSave(true);
    try {
      await window.electron.deleteGameCloudSaveData(objectId, shop);
    } catch {
      showErrorToast(
        t("cloud_save_v2_delete_error_title"),
        t("cloud_save_v2_delete_error_description")
      );
      setIsDeletingCloudSave(false);
      return;
    }

    setIsDeleteConfirmationVisible(false);
    showSuccessToast(t("cloud_save_v2_delete_success"));
    try {
      await onRetry();
    } catch {
      // The deletion succeeded. Existing refresh error handling remains visible.
    } finally {
      setIsDeletingCloudSave(false);
    }
  };

  const loadingState = !details && isLoading;
  const errorState = !details && hasError;
  const { actionsAreDisabled, closeIsBlocked } =
    getCloudSaveFileBrowserOperationPolicy({
      isAddingCustomPath,
      isRebindingCustomPath: rebindingCustomPath !== null,
      isRemovingCustomPath: removingCustomPath !== null,
      isDeletingCloudSave,
      isLoading,
      isGameRunning,
      isSyncing,
    });
  const activeOperation = isDeletingCloudSave
    ? getCloudSaveOperationPresentation(null, "cloud_save_v2_deleting")
    : isSyncing
      ? getCloudSaveOperationPresentation(progress)
      : null;
  const activeOperationFileCount = activeOperation?.fileCount
    ? t("cloud_save_v2_progress_file_count", activeOperation.fileCount)
    : null;
  const hasSaveData = hasCloudSaveDataToDelete(details);
  const addCustomPathButton = (
    <Button
      theme="outline"
      className="cloud-save-v2__add-custom-path-button"
      disabled={actionsAreDisabled}
      onClick={() => void handleAddCustomPath()}
    >
      {isAddingCustomPath ? (
        <CircleNotchIcon className="cloud-save-v2__spinner" size={16} />
      ) : (
        <PlusIcon size={16} />
      )}
      <span>{t("cloud_save_v2_add_custom_path")}</span>
    </Button>
  );
  const deleteCloudSaveButton = hasSaveData ? (
    <Button
      theme="danger"
      className="cloud-save-v2__delete-cloud-save-button"
      disabled={actionsAreDisabled}
      onClick={() => setIsDeleteConfirmationVisible(true)}
    >
      <TrashIcon size={16} />
      <span>{t("cloud_save_v2_delete")}</span>
    </Button>
  ) : null;

  return (
    <>
      <Modal
        visible={visible}
        title={
          titleIsConflict
            ? t("cloud_save_v2_conflicts_modal_title")
            : t("cloud_save_v2_files_modal_title")
        }
        description={
          titleIsConflict
            ? t("cloud_save_v2_conflicts_modal_description")
            : t("cloud_save_v2_files_modal_description")
        }
        className={`cloud-save-v2__file-browser-modal ${titleIsConflict ? "cloud-save-v2__file-browser-modal--comparison" : ""}`}
        onClose={() => {
          if (!closeIsBlocked) onClose();
        }}
      >
        <div className="cloud-save-v2__file-browser">
          {loadingState && (
            <div className="cloud-save-v2__browser-state">
              <CircleNotchIcon className="cloud-save-v2__spinner" size={20} />
              <span>{t("cloud_save_v2_files_loading")}</span>
            </div>
          )}

          {errorState && (
            <div className="cloud-save-v2__browser-state cloud-save-v2__browser-state--error">
              <WarningCircleIcon size={20} />
              <span>{t("cloud_save_v2_files_error")}</span>
              <Button theme="outline" onClick={onRetry}>
                {t("cloud_save_v2_files_retry")}
              </Button>
            </div>
          )}

          {details && (
            <>
              {(activeOperation ||
                isConflict ||
                localRoots.length > 0 ||
                hasSaveData) && (
                <div className="cloud-save-v2__browser-toolbar">
                  {activeOperation ? (
                    <div
                      className="cloud-save-v2__browser-source-summary"
                      role="status"
                      aria-live="polite"
                    >
                      <span>
                        <CircleNotchIcon
                          className="cloud-save-v2__spinner"
                          size={20}
                        />
                        <strong>{t(activeOperation.labelKey)}</strong>
                        {activeOperationFileCount && (
                          <span aria-hidden="true">·</span>
                        )}
                        {activeOperationFileCount && (
                          <span className="cloud-save-v2__browser-operation-count">
                            {activeOperationFileCount}
                          </span>
                        )}
                      </span>
                    </div>
                  ) : !isConflict ? (
                    <div className="cloud-save-v2__browser-source-summary">
                      <span>
                        <MonitorIcon
                          size={20}
                          className="cloud-save-v2__browser-monitor-icon"
                        />
                        <strong>{t("cloud_save_v2_local_files")}</strong>
                        {t("cloud_save_v2_source_summary", {
                          count: details.local.fileCount,
                          size: formatBytes(details.local.totalSizeBytes),
                        })}
                      </span>
                    </div>
                  ) : null}

                  {!isConflict && (
                    <div className="cloud-save-v2__browser-toolbar-actions">
                      {deleteCloudSaveButton}
                      {addCustomPathButton}
                    </div>
                  )}

                  {isConflict && !activeOperation && (
                    <div className="cloud-save-v2__browser-diff-summary">
                      <span>
                        {t("cloud_save_v2_diff_modified", {
                          count: comparisonCounts.modified,
                        })}
                      </span>
                      <span>
                        {t("cloud_save_v2_diff_local_only", {
                          count: comparisonCounts.localOnly,
                        })}
                      </span>
                      <span>
                        {t("cloud_save_v2_diff_remote_only", {
                          count: comparisonCounts.remoteOnly,
                        })}
                      </span>
                      {!showOnlyChanged && (
                        <span>
                          {t("cloud_save_v2_diff_unchanged", {
                            count: comparisonCounts.unchanged,
                          })}
                        </span>
                      )}
                    </div>
                  )}

                  {isConflict && (
                    <div className="cloud-save-v2__browser-toolbar-actions">
                      <div className="cloud-save-v2__browser-filter">
                        <CheckboxField
                          label={t("cloud_save_v2_show_only_changed")}
                          checked={showOnlyChanged}
                          onChange={(event) =>
                            setShowOnlyChanged(event.target.checked)
                          }
                        />
                      </div>
                      {deleteCloudSaveButton}
                    </div>
                  )}
                </div>
              )}

              {hasError && (
                <div className="cloud-save-v2__browser-inline-error">
                  <WarningCircleIcon size={16} />
                  <span>{t("cloud_save_v2_files_refresh_error")}</span>
                  <button type="button" onClick={onRetry}>
                    {t("cloud_save_v2_files_retry")}
                  </button>
                </div>
              )}

              <CloudSaveV2FileContent
                details={details}
                isConflict={isConflict}
                comparisonRoots={comparisonRoots}
                localRoots={localRoots}
                isLoading={isLoading}
                actionsDisabled={actionsAreDisabled}
                addCustomPathButton={hasSaveData ? null : addCustomPathButton}
                onRetry={onRetry}
                onOpenFolder={(path) => void handleOpenFolder(path)}
                onRebindCustomPath={(rawPath) =>
                  void handleRebindCustomPath(rawPath)
                }
                onRemoveCustomPath={setPendingCustomPathRemoval}
              />
            </>
          )}
        </div>
      </Modal>

      <ConfirmationModal
        visible={pendingCustomPathRemoval !== null}
        title={t("cloud_save_v2_remove_custom_path_title")}
        descriptionText={t("cloud_save_v2_remove_custom_path_description")}
        confirmButtonLabel={t("cloud_save_v2_remove")}
        cancelButtonLabel={t("cloud_save_v2_cancel")}
        buttonsIsDisabled={removingCustomPath !== null}
        onConfirm={() => void handleRemoveCustomPath()}
        onClose={() => {
          if (!removingCustomPath) setPendingCustomPathRemoval(null);
        }}
      />

      <ConfirmationModal
        visible={isDeleteConfirmationVisible}
        title={t("cloud_save_v2_delete_title")}
        descriptionText={t("cloud_save_v2_delete_description")}
        confirmButtonLabel={t(
          isDeletingCloudSave
            ? "cloud_save_v2_deleting"
            : "cloud_save_v2_delete_confirm"
        )}
        confirmButtonTheme="danger"
        cancelButtonLabel={t("cloud_save_v2_cancel")}
        buttonsIsDisabled={isDeletingCloudSave}
        onConfirm={() => void handleDeleteCloudSave()}
        onClose={() => {
          if (!isDeletingCloudSave) setIsDeleteConfirmationVisible(false);
        }}
      />
    </>
  );
}
