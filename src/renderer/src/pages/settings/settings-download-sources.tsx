import { useContext, useEffect, useState } from "react";

import {
  TextField,
  Button,
  Badge,
  ConfirmationModal,
  Modal,
} from "@renderer/components";
import { useTranslation } from "react-i18next";

import type { DownloadSource } from "@types";
import {
  DownloadIcon,
  UploadIcon,
  NoEntryIcon,
  PlusCircleIcon,
  SyncIcon,
  TrashIcon,
} from "@primer/octicons-react";
import { AddDownloadSourceModal } from "./add-download-source-modal";
import { useAppDispatch, useToast } from "@renderer/hooks";
import { useFormat } from "@renderer/hooks/use-format";
import { DownloadSourceStatus } from "@shared";
import { settingsContext } from "@renderer/context";
import { useNavigate } from "react-router-dom";
import { setFilters, clearFilters } from "@renderer/features";
import { levelDBService } from "@renderer/services/leveldb.service";
import { orderBy } from "lodash-es";
import "./settings-download-sources.scss";
import { logger } from "@renderer/logger";
import { useDownloadSourceTransferStore } from "@renderer/features/download-source-transfer";
import { getDownloadSourceImportErrorKey } from "./download-source-import-error";

export function SettingsDownloadSources() {
  const [
    showConfirmationDeleteAllSourcesModal,
    setShowConfirmationDeleteAllSourcesModal,
  ] = useState(false);
  const [showAddDownloadSourceModal, setShowAddDownloadSourceModal] =
    useState(false);
  const [downloadSources, setDownloadSources] = useState<DownloadSource[]>([]);
  const [hasLoadedDownloadSources, setHasLoadedDownloadSources] =
    useState(false);
  const [isSyncingDownloadSources, setIsSyncingDownloadSources] =
    useState(false);
  const [isRemovingDownloadSource, setIsRemovingDownloadSource] =
    useState(false);

  const { activeTransfer, setActiveTransfer, importResult, setImportResult } =
    useDownloadSourceTransferStore();
  const isTransferringSources = activeTransfer !== null;

  const { sourceUrl, clearSourceUrl } = useContext(settingsContext);

  const { t } = useTranslation("settings");
  const { showSuccessToast, showErrorToast } = useToast();
  const { numberFormatter } = useFormat();

  const dispatch = useAppDispatch();

  const navigate = useNavigate();

  useEffect(() => {
    if (sourceUrl) setShowAddDownloadSourceModal(true);
  }, [sourceUrl]);

  useEffect(() => {
    let cancelled = false;
    const fetchDownloadSources = async () => {
      const sources = (await levelDBService.values(
        "downloadSources"
      )) as DownloadSource[];
      const sorted = orderBy(sources, "createdAt", "desc");
      if (cancelled) return;
      setDownloadSources(sorted);
      setHasLoadedDownloadSources(true);
    };

    fetchDownloadSources().catch((error) =>
      logger.error("Failed to fetch download sources:", error)
    );
    return () => {
      cancelled = true;
    };
  }, [activeTransfer]);

  useEffect(() => {
    const hasPendingOrMatchingSource = downloadSources.some(
      (source) =>
        source.status === DownloadSourceStatus.PendingMatching ||
        source.status === DownloadSourceStatus.Matching
    );

    if (
      isTransferringSources ||
      !hasPendingOrMatchingSource ||
      !downloadSources.length
    ) {
      return;
    }

    const intervalId = setInterval(async () => {
      try {
        await window.electron.syncDownloadSources();
        const sources = (await levelDBService.values(
          "downloadSources"
        )) as DownloadSource[];
        const sorted = orderBy(sources, "createdAt", "desc");
        setDownloadSources(sorted);
      } catch (error) {
        logger.error("Failed to fetch download sources:", error);
      }
    }, 5000);

    return () => clearInterval(intervalId);
  }, [downloadSources, isTransferringSources]);

  const handleRemoveSource = async (downloadSource: DownloadSource) => {
    setIsRemovingDownloadSource(true);

    try {
      await window.electron.removeDownloadSource(false, downloadSource.id);
      const sources = (await levelDBService.values(
        "downloadSources"
      )) as DownloadSource[];
      const sorted = orderBy(sources, "createdAt", "desc");
      setDownloadSources(sorted);
      showSuccessToast(t("removed_download_source"));
    } catch (error) {
      logger.error("Failed to remove download source:", error);
    } finally {
      setIsRemovingDownloadSource(false);
    }
  };

  const handleRemoveAllDownloadSources = async () => {
    setIsRemovingDownloadSource(true);

    try {
      await window.electron.removeDownloadSource(true);
      const sources = (await levelDBService.values(
        "downloadSources"
      )) as DownloadSource[];
      const sorted = orderBy(sources, "createdAt", "desc");
      setDownloadSources(sorted);
      showSuccessToast(t("removed_all_download_sources"));
    } catch (error) {
      logger.error("Failed to remove all download sources:", error);
    } finally {
      setIsRemovingDownloadSource(false);
      setShowConfirmationDeleteAllSourcesModal(false);
    }
  };

  const handleAddDownloadSource = async () => {
    try {
      const sources = (await levelDBService.values(
        "downloadSources"
      )) as DownloadSource[];
      const sorted = orderBy(sources, "createdAt", "desc");
      setDownloadSources(sorted);
    } catch (error) {
      logger.error("Failed to refresh download sources:", error);
    }
  };

  const exportDownloadSources = async () => {
    setActiveTransfer("export");
    try {
      if (await window.electron.exportDownloadSources()) {
        showSuccessToast(t("download_sources_exported"));
      }
    } catch (error) {
      logger.error("Failed to export download sources:", error);
      showErrorToast(t("download_sources_export_failed"));
    } finally {
      setActiveTransfer(null);
    }
  };

  const importDownloadSources = async () => {
    setActiveTransfer("import");
    try {
      const result = await window.electron.importDownloadSources();
      if (result) {
        setImportResult(result);
      }
    } catch (error) {
      logger.error("Failed to import download sources:", error);
      showErrorToast(t(getDownloadSourceImportErrorKey(error)));
    } finally {
      setActiveTransfer(null);
    }
  };

  const isBusy =
    isSyncingDownloadSources ||
    isRemovingDownloadSource ||
    isTransferringSources;

  const syncDownloadSources = async () => {
    setIsSyncingDownloadSources(true);
    try {
      await window.electron.syncDownloadSources();
      const sources = (await levelDBService.values(
        "downloadSources"
      )) as DownloadSource[];
      const sorted = orderBy(sources, "createdAt", "desc");
      setDownloadSources(sorted);

      showSuccessToast(t("download_sources_synced_successfully"));
    } finally {
      setIsSyncingDownloadSources(false);
    }
  };

  const statusTitle = {
    [DownloadSourceStatus.PendingMatching]: t(
      "download_source_pending_matching"
    ),
    [DownloadSourceStatus.Matched]: t("download_source_matched"),
    [DownloadSourceStatus.Matching]: t("download_source_matching"),
    [DownloadSourceStatus.Failed]: t("download_source_failed"),
  };

  const handleModalClose = () => {
    clearSourceUrl();
    setShowAddDownloadSourceModal(false);
  };

  const navigateToCatalogue = (fingerprint?: string) => {
    if (!fingerprint) {
      logger.error("Cannot navigate: fingerprint is undefined");
      return;
    }

    dispatch(clearFilters());
    dispatch(setFilters({ downloadSourceFingerprints: [fingerprint] }));

    navigate("/catalogue");
  };

  return (
    <>
      <AddDownloadSourceModal
        visible={showAddDownloadSourceModal && !isTransferringSources}
        onClose={handleModalClose}
        onAddDownloadSource={handleAddDownloadSource}
      />
      <ConfirmationModal
        cancelButtonLabel={t("cancel_button_confirmation_delete_all_sources")}
        confirmButtonLabel={t("confirm_button_confirmation_delete_all_sources")}
        descriptionText={t("description_confirmation_delete_all_sources")}
        clickOutsideToClose={false}
        onConfirm={handleRemoveAllDownloadSources}
        visible={showConfirmationDeleteAllSourcesModal}
        title={t("title_confirmation_delete_all_sources")}
        onClose={() => setShowConfirmationDeleteAllSourcesModal(false)}
        buttonsIsDisabled={isBusy}
      />

      <Modal
        visible={Boolean(importResult)}
        title={t("download_sources_import_result")}
        onClose={() => setImportResult(null)}
      >
        {importResult && (
          <div className="settings-download-sources__import-result">
            <p>
              {t("download_sources_import_summary", {
                ...importResult,
                failedCount: importResult.failed.length,
              })}
            </p>
            {importResult.failed.length > 0 && (
              <>
                <p>{t("download_sources_import_retry")}</p>
                <ul className="settings-download-sources__failed-urls">
                  {importResult.failed.map((url) => (
                    <li key={url}>{url}</li>
                  ))}
                </ul>
              </>
            )}
            <Button type="button" onClick={() => setImportResult(null)}>
              {t("header:close")}
            </Button>
          </div>
        )}
      </Modal>

      <p>{t("download_sources_description")}</p>

      <div className="settings-download-sources__header">
        <div className="settings-download-sources__buttons-container">
          <Button
            type="button"
            theme="outline"
            disabled={
              (hasLoadedDownloadSources && !downloadSources.length) || isBusy
            }
            onClick={syncDownloadSources}
          >
            <SyncIcon />
            {t("sync_download_sources")}
          </Button>
          <Button
            type="button"
            theme="outline"
            disabled={
              !hasLoadedDownloadSources || !downloadSources.length || isBusy
            }
            onClick={exportDownloadSources}
          >
            <UploadIcon />
            {t(
              activeTransfer === "export"
                ? "transferring_download_sources"
                : "export_download_sources"
            )}
          </Button>
          <Button
            type="button"
            theme="outline"
            disabled={!hasLoadedDownloadSources || isBusy}
            onClick={importDownloadSources}
          >
            <DownloadIcon />
            {t(
              activeTransfer === "import"
                ? "transferring_download_sources"
                : "import_download_sources"
            )}
          </Button>
        </div>

        <div className="settings-download-sources__buttons-container">
          <Button
            type="button"
            theme="danger"
            onClick={() => setShowConfirmationDeleteAllSourcesModal(true)}
            disabled={
              isBusy || (hasLoadedDownloadSources && !downloadSources.length)
            }
          >
            <TrashIcon />
            {t("button_delete_all_sources")}
          </Button>

          <Button
            type="button"
            theme="outline"
            onClick={() => setShowAddDownloadSourceModal(true)}
            disabled={isBusy}
          >
            <PlusCircleIcon />
            {t("add_download_source")}
          </Button>
        </div>
      </div>

      <ul className="settings-download-sources__list">
        {downloadSources.map((downloadSource) => {
          const isPendingOrMatching =
            downloadSource.status === DownloadSourceStatus.PendingMatching ||
            downloadSource.status === DownloadSourceStatus.Matching;

          return (
            <li
              key={downloadSource.id}
              className={`settings-download-sources__item ${isSyncingDownloadSources ? "settings-download-sources__item--syncing" : ""} ${isPendingOrMatching ? "settings-download-sources__item--pending" : ""}`}
            >
              <div className="settings-download-sources__item-header">
                <h2>{downloadSource.name}</h2>

                <div style={{ display: "flex" }}>
                  <Badge>
                    {isPendingOrMatching && (
                      <SyncIcon className="settings-download-sources__spinner" />
                    )}
                    {statusTitle[downloadSource.status]}
                  </Badge>
                </div>

                <button
                  type="button"
                  className="settings-download-sources__navigate-button"
                  disabled={!downloadSource.fingerprint}
                  onClick={() =>
                    navigateToCatalogue(downloadSource.fingerprint)
                  }
                >
                  <small>
                    {isPendingOrMatching
                      ? t("download_source_no_information")
                      : t("download_count", {
                          count: downloadSource.downloadCount,
                          countFormatted: numberFormatter.format(
                            downloadSource.downloadCount
                          ),
                        })}
                  </small>
                </button>
              </div>

              <TextField
                label={t("download_source_url")}
                value={downloadSource.url}
                readOnly
                theme="dark"
                disabled
                rightContent={
                  <Button
                    type="button"
                    theme="outline"
                    onClick={() => handleRemoveSource(downloadSource)}
                    disabled={isBusy}
                  >
                    <NoEntryIcon />
                    {t("remove_download_source")}
                  </Button>
                }
              />
            </li>
          );
        })}
      </ul>
    </>
  );
}
