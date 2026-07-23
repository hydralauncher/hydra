import { useEffect, useMemo, useState } from "react";
import {
  CircleNotchIcon,
  CloudIcon,
  MonitorIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

import type { CloudSaveState, CloudSaveV2FileDetails, GameShop } from "@types";
import { formatBytes } from "@shared";
import { Button, CheckboxField, Modal } from "@renderer/components";
import { useToast } from "@renderer/hooks";

import {
  buildCloudSaveV2ComparisonTree,
  buildCloudSaveV2LocalFileTree,
  filterCloudSaveV2Comparisons,
} from "./cloud-save-v2-file-tree";
import { CloudSaveV2FileTreeView } from "./cloud-save-v2-file-tree-view";

interface CloudSaveV2FileBrowserModalProps {
  visible: boolean;
  objectId: string;
  shop: GameShop;
  overviewState: CloudSaveState | null;
  details: CloudSaveV2FileDetails | null;
  isLoading: boolean;
  hasError: boolean;
  onRetry: () => void;
  onClose: () => void;
}

export function CloudSaveV2FileBrowserModal({
  visible,
  objectId,
  shop,
  overviewState,
  details,
  isLoading,
  hasError,
  onRetry,
  onClose,
}: Readonly<CloudSaveV2FileBrowserModalProps>) {
  const { t } = useTranslation("game_details");
  const { showErrorToast } = useToast();
  const [showOnlyChanged, setShowOnlyChanged] = useState(true);
  const [isFileListScrolled, setIsFileListScrolled] = useState(false);
  const isConflict = details?.state === "conflict";
  const titleIsConflict = isConflict || overviewState === "conflict";
  const visibleComparisons = useMemo(
    () =>
      filterCloudSaveV2Comparisons(details?.comparisons ?? [], showOnlyChanged),
    [details?.comparisons, showOnlyChanged]
  );
  const localRoots = useMemo(
    () => buildCloudSaveV2LocalFileTree(details?.local.files ?? []),
    [details?.local.files]
  );
  const comparisonRoots = useMemo(
    () => buildCloudSaveV2ComparisonTree(visibleComparisons),
    [visibleComparisons]
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
    if (!visible) setShowOnlyChanged(true);
  }, [visible]);

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

  const loadingState = !details && isLoading;
  const errorState = !details && hasError;

  return (
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
      onClose={onClose}
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
            {(details.variants.length > 0 ||
              details.unresolvedRemoteVariantCount > 0) && (
              <section
                className="cloud-save-v2__variant-diagnostics"
                aria-label={t("cloud_save_v2_variants_title")}
              >
                <strong>{t("cloud_save_v2_variants_title")}</strong>
                <div className="cloud-save-v2__variant-list">
                  {details.variants.map((variant) => (
                    <div
                      className="cloud-save-v2__variant-item"
                      key={variant.variantId}
                    >
                      <span>
                        {variant.userLabel}
                        {variant.active && (
                          <em>{t("cloud_save_v2_variant_active")}</em>
                        )}
                      </span>
                      <span>
                        {t("cloud_save_v2_variant_file_count", {
                          count: variant.fileCount,
                        })}
                      </span>
                      {variant.conflictCount > 0 && (
                        <small className="cloud-save-v2__variant-conflicts">
                          <WarningCircleIcon size={14} />
                          {t("cloud_save_v2_variant_conflict_count", {
                            count: variant.conflictCount,
                          })}
                        </small>
                      )}
                      {variant.warningCodes.length > 0 && (
                        <small>
                          <WarningCircleIcon size={14} />
                          {variant.warningCodes.join(", ")}
                        </small>
                      )}
                    </div>
                  ))}
                </div>
                {details.unresolvedRemoteVariantCount > 0 && (
                  <p className="cloud-save-v2__variant-unresolved">
                    <WarningCircleIcon size={16} />
                    {t("cloud_save_v2_unresolved_variant_count", {
                      count: details.unresolvedRemoteVariantCount,
                    })}
                  </p>
                )}
              </section>
            )}

            <div className="cloud-save-v2__browser-toolbar">
              {!isConflict && (
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
              )}

              {isConflict && (
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
                <div className="cloud-save-v2__browser-filter">
                  <CheckboxField
                    label={t("cloud_save_v2_show_only_changed")}
                    checked={showOnlyChanged}
                    onChange={(event) =>
                      setShowOnlyChanged(event.target.checked)
                    }
                  />
                </div>
              )}
            </div>

            {hasError && (
              <div className="cloud-save-v2__browser-inline-error">
                <WarningCircleIcon size={16} />
                <span>{t("cloud_save_v2_files_refresh_error")}</span>
                <button type="button" onClick={onRetry}>
                  {t("cloud_save_v2_files_retry")}
                </button>
              </div>
            )}

            {isConflict && details.activeSnapshot ? (
              <>
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
                            size: formatBytes(
                              details.activeSnapshot.totalSizeBytes
                            ),
                          })}
                        </span>
                      </div>
                    </div>
                    {comparisonRoots.length > 0 ? (
                      <CloudSaveV2FileTreeView
                        roots={comparisonRoots}
                        mode="comparison"
                        onOpenFolder={(path) => void handleOpenFolder(path)}
                      />
                    ) : (
                      <p className="cloud-save-v2__browser-empty">
                        {t("cloud_save_v2_no_visible_differences")}
                      </p>
                    )}
                  </div>
                </div>
              </>
            ) : details.local.files.length > 0 ? (
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
                  onOpenFolder={(path) => void handleOpenFolder(path)}
                />
              </div>
            ) : (
              <p className="cloud-save-v2__browser-empty">
                {t("cloud_save_v2_no_local_files")}
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
