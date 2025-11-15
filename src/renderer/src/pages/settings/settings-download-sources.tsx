import { useContext, useEffect, useState } from "react";

import {
  TextField,
  Button,
  Badge,
  ConfirmationModal,
} from "@renderer/components";
import { useTranslation } from "react-i18next";

import type { DownloadSource } from "@types";
import {
  NoEntryIcon,
  PlusCircleIcon,
  DownloadIcon,
  UploadIcon,
  SyncIcon,
  TrashIcon,
} from "@primer/octicons-react";
import { AddDownloadSourceModal } from "./add-download-source-modal";
import { useAppDispatch, useToast } from "@renderer/hooks";
import { DownloadSourceStatus } from "@shared";
import { settingsContext } from "@renderer/context";
import { useNavigate } from "react-router-dom";
import { setFilters, clearFilters } from "@renderer/features";
import "./settings-download-sources.scss";
import { logger } from "@renderer/logger";

export function SettingsDownloadSources() {
  const [
    showConfirmationDeleteAllSourcesModal,
    setShowConfirmationDeleteAllSourcesModal,
  ] = useState(false);
  const [showAddDownloadSourceModal, setShowAddDownloadSourceModal] =
    useState(false);
  const [downloadSources, setDownloadSources] = useState<DownloadSource[]>([]);
  const [isSyncingDownloadSources, setIsSyncingDownloadSources] =
    useState(false);
  const [isRemovingDownloadSource, setIsRemovingDownloadSource] =
    useState(false);
  const [isExportingDownloadSources, setIsExportingDownloadSources] =
    useState(false);
  const [isImportingDownloadSources, setIsImportingDownloadSources] =
    useState(false);

  const { sourceUrl, clearSourceUrl } = useContext(settingsContext);

  const { t } = useTranslation("settings");
  const { showSuccessToast, showErrorToast, showWarningToast } = useToast();

  const dispatch = useAppDispatch();

  const navigate = useNavigate();

  useEffect(() => {
    if (sourceUrl) setShowAddDownloadSourceModal(true);
  }, [sourceUrl]);

  useEffect(() => {
    const fetchDownloadSources = async () => {
      const sources = await window.electron.getDownloadSources();
      setDownloadSources(sources);
    };

    fetchDownloadSources();
  }, []);

  useEffect(() => {
    const hasPendingOrMatchingSource = downloadSources.some(
      (source) =>
        source.status === DownloadSourceStatus.PendingMatching ||
        source.status === DownloadSourceStatus.Matching
    );

    if (!hasPendingOrMatchingSource || !downloadSources.length) {
      return;
    }

    const intervalId = setInterval(async () => {
      try {
        await window.electron.syncDownloadSources();
        const sources = await window.electron.getDownloadSources();
        setDownloadSources(sources);
      } catch (error) {
        logger.error("Failed to fetch download sources:", error);
      }
    }, 5000);

    return () => clearInterval(intervalId);
  }, [downloadSources]);

  const handleRemoveSource = async (downloadSource: DownloadSource) => {
    setIsRemovingDownloadSource(true);

    try {
      await window.electron.removeDownloadSource(false, downloadSource.id);
      const sources = await window.electron.getDownloadSources();
      setDownloadSources(sources);
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
      const sources = await window.electron.getDownloadSources();
      setDownloadSources(sources);
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
      const sources = await window.electron.getDownloadSources();
      setDownloadSources(sources);
    } catch (error) {
      logger.error("Failed to refresh download sources:", error);
    }
  };

  const syncDownloadSources = async () => {
    setIsSyncingDownloadSources(true);
    try {
      await window.electron.syncDownloadSources();
      const sources = await window.electron.getDownloadSources();
      setDownloadSources(sources);

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

  const getDefaultExportFileName = () => {
    const timestamp = new Date().toISOString().replace(/[:]/g, "-");
    return `hydra-download-sources-${timestamp}.json`;
  };

  const handleExportDownloadSources = async () => {
    const { canceled, filePath } = await window.electron.showSaveDialog({
      title: t("export_download_sources"),
      defaultPath: getDefaultExportFileName(),
      filters: [
        {
          name: t("download_sources_json_filter"),
          extensions: ["json"],
        },
      ],
    });

    if (canceled || !filePath) {
      return;
    }

    setIsExportingDownloadSources(true);

    try {
      const result = await window.electron.exportDownloadSources(filePath);
      const countFormatted = result.exported.toLocaleString();
      showSuccessToast(
        t("download_sources_export_success", {
          count: result.exported,
          countFormatted,
        })
      );
    } catch (error) {
      logger.error("Failed to export download sources:", error);
      showErrorToast(t("download_sources_export_failed"));
    } finally {
      setIsExportingDownloadSources(false);
    }
  };

  const handleImportDownloadSources = async () => {
    const { canceled, filePaths } = await window.electron.showOpenDialog({
      properties: ["openFile"],
      filters: [
        {
          name: t("download_sources_json_filter"),
          extensions: ["json"],
        },
      ],
    });

    if (canceled || !filePaths || !filePaths.length) {
      return;
    }

    const [selectedFilePath] = filePaths;

    setIsImportingDownloadSources(true);

    try {
      const result = await window.electron.importDownloadSources(
        selectedFilePath
      );
      const sources = await window.electron.getDownloadSources();
      setDownloadSources(sources);

      if (result.imported > 0) {
        const importedFormatted = result.imported.toLocaleString();
        showSuccessToast(
          t("download_sources_import_success", {
            count: result.imported,
            countFormatted: importedFormatted,
          })
        );
      }

      if (result.skipped > 0) {
        const skippedFormatted = result.skipped.toLocaleString();
        showWarningToast(
          t("download_sources_import_skipped", {
            count: result.skipped,
            countFormatted: skippedFormatted,
          })
        );
      }
    } catch (error) {
      logger.error("Failed to import download sources:", error);
      showErrorToast(t("download_sources_import_failed"));
    } finally {
      setIsImportingDownloadSources(false);
    }
  };

  return (
    <>
      <AddDownloadSourceModal
        visible={showAddDownloadSourceModal}
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
        buttonsIsDisabled={isRemovingDownloadSource}
      />

      <p>{t("download_sources_description")}</p>

      <div className="settings-download-sources__header">
        <Button
          type="button"
          theme="outline"
          disabled={
            !downloadSources.length ||
            isSyncingDownloadSources ||
            isRemovingDownloadSource ||
            isExportingDownloadSources ||
            isImportingDownloadSources
          }
          onClick={syncDownloadSources}
        >
          <SyncIcon />
          {t("sync_download_sources")}
        </Button>

        <div className="settings-download-sources__buttons-container">
          <Button
            type="button"
            theme="outline"
            onClick={handleExportDownloadSources}
            disabled={
              !downloadSources.length ||
              isRemovingDownloadSource ||
              isSyncingDownloadSources ||
              isExportingDownloadSources ||
              isImportingDownloadSources
            }
          >
            {isExportingDownloadSources ? (
              <SyncIcon className="settings-download-sources__spinner" />
            ) : (
              <DownloadIcon />
            )}
            {t("export_download_sources")}
          </Button>

          <Button
            type="button"
            theme="outline"
            onClick={handleImportDownloadSources}
            disabled={
              isRemovingDownloadSource ||
              isSyncingDownloadSources ||
              isExportingDownloadSources ||
              isImportingDownloadSources
            }
          >
            {isImportingDownloadSources ? (
              <SyncIcon className="settings-download-sources__spinner" />
            ) : (
              <UploadIcon />
            )}
            {t("import_download_sources")}
          </Button>

          <Button
            type="button"
            theme="danger"
            onClick={() => setShowConfirmationDeleteAllSourcesModal(true)}
            disabled={
              isRemovingDownloadSource ||
              isSyncingDownloadSources ||
              !downloadSources.length ||
              isExportingDownloadSources ||
              isImportingDownloadSources
            }
          >
            <TrashIcon />
            {t("button_delete_all_sources")}
          </Button>

          <Button
            type="button"
            theme="outline"
            onClick={() => setShowAddDownloadSourceModal(true)}
            disabled={
              isSyncingDownloadSources ||
              isRemovingDownloadSource ||
              isExportingDownloadSources ||
              isImportingDownloadSources
            }
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
                          countFormatted:
                            downloadSource.downloadCount.toLocaleString(),
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
                    disabled={
                      isRemovingDownloadSource || isImportingDownloadSources
                    }
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
