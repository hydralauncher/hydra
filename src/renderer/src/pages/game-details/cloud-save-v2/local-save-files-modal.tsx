import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowClockwiseIcon,
  CircleNotchIcon,
  MonitorIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

import type { CloudSaveV2FileDetails, GameShop } from "@types";
import { formatBytes } from "@shared";
import { Button, Modal } from "@renderer/components";
import { useToast } from "@renderer/hooks";

import { buildCloudSaveV2LocalFileTree } from "./cloud-save-v2-file-tree";
import { CloudSaveV2FileTreeView } from "./cloud-save-v2-file-tree-view";

interface LocalSaveFilesModalProps {
  visible: boolean;
  objectId: string;
  shop: GameShop;
  onClose: () => void;
}

const noop = () => {};

export function LocalSaveFilesModal({
  visible,
  objectId,
  shop,
  onClose,
}: Readonly<LocalSaveFilesModalProps>) {
  const { t } = useTranslation("game_details");
  const { showErrorToast } = useToast();
  const [details, setDetails] = useState<CloudSaveV2FileDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isFileListScrolled, setIsFileListScrolled] = useState(false);

  const loadDetails = useCallback(async () => {
    setIsLoading(true);
    setHasError(false);
    try {
      setDetails(await window.electron.getLocalSaveFileDetails(objectId, shop));
    } catch {
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  }, [objectId, shop]);

  useEffect(() => {
    if (visible) void loadDetails();
  }, [loadDetails, visible]);

  const localRoots = useMemo(
    () => buildCloudSaveV2LocalFileTree(details?.local.files ?? [], [], []),
    [details?.local.files]
  );

  const handleOpenFolder = async (path: string) => {
    const opened = await window.electron
      .openGameSaveFolder(shop, objectId, path)
      .catch(() => false);
    if (!opened) {
      showErrorToast(
        t("cloud_save_v2_path_unavailable_title"),
        t("cloud_save_v2_path_unavailable_description")
      );
    }
  };

  const retryButton = (
    <Button disabled={isLoading} onClick={() => void loadDetails()}>
      {isLoading ? (
        <CircleNotchIcon className="cloud-save-v2__spinner" size={16} />
      ) : (
        <ArrowClockwiseIcon size={16} />
      )}
      <span>{t("cloud_save_v2_check_again")}</span>
    </Button>
  );

  return (
    <Modal
      visible={visible}
      title={t("cloud_save_v2_files_modal_title")}
      description={t("cloud_save_v2_files_modal_description")}
      className="cloud-save-v2__file-browser-modal"
      onClose={onClose}
    >
      <div className="cloud-save-v2__file-browser">
        {isLoading && !details && (
          <div className="cloud-save-v2__browser-state">
            <CircleNotchIcon className="cloud-save-v2__spinner" size={20} />
            <span>{t("cloud_save_v2_files_loading")}</span>
          </div>
        )}

        {hasError && !details && (
          <div className="cloud-save-v2__browser-state cloud-save-v2__browser-state--error">
            <WarningCircleIcon size={20} />
            <span>{t("cloud_save_v2_files_error")}</span>
            <Button theme="outline" onClick={() => void loadDetails()}>
              {t("cloud_save_v2_files_retry")}
            </Button>
          </div>
        )}

        {details && localRoots.length > 0 && (
          <>
            <div className="cloud-save-v2__browser-toolbar">
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
            </div>

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
                onRebindCustomPath={noop}
                onRemoveCustomPath={noop}
                customPathActionsDisabled
              />
            </div>
          </>
        )}

        {details && localRoots.length === 0 && (
          <div className="cloud-save-v2__browser-empty cloud-save-v2__browser-empty--actions">
            <div className="cloud-save-v2__browser-empty-copy">
              <strong>{t("cloud_save_v2_no_local_files")}</strong>
              <span>{t("local_save_files_empty_description")}</span>
            </div>
            <div className="cloud-save-v2__browser-empty-actions">
              {retryButton}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
