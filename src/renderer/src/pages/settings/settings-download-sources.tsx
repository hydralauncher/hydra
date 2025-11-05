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
  SyncIcon,
  TrashIcon,
} from "@primer/octicons-react";
import { AddDownloadSourceModal } from "./add-download-source-modal";
import { useAppDispatch, useToast } from "@renderer/hooks";
import { DownloadSourceStatus } from "@shared";
import { settingsContext, downloadSourcesContext } from "@renderer/context";
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
  const [isSyncingDownloadSources, setIsSyncingDownloadSources] =
    useState(false);
  const [isRemovingDownloadSource, setIsRemovingDownloadSource] =
    useState(false);

  const { sourceUrl, clearSourceUrl } = useContext(settingsContext);
  const {
    downloadSources,
    isLoading: isLoadingSources,
    refreshDownloadSources,
  } = useContext(downloadSourcesContext);

  const { t } = useTranslation("settings");
  const { showSuccessToast } = useToast();

  const dispatch = useAppDispatch();

  const navigate = useNavigate();

  useEffect(() => {
    if (sourceUrl) setShowAddDownloadSourceModal(true);
  }, [sourceUrl]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        refreshDownloadSources();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshDownloadSources]);

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
        await refreshDownloadSources();
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
      await refreshDownloadSources();
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
      await refreshDownloadSources();
      showSuccessToast(t("removed_all_download_sources"));
    } catch (error) {
      logger.error("Failed to remove all download sources:", error);
    } finally {
      setIsRemovingDownloadSource(false);
      setShowConfirmationDeleteAllSourcesModal(false);
    }
  };

  const handleAddDownloadSource = async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await refreshDownloadSources();
  };

  const syncDownloadSources = async () => {
    setIsSyncingDownloadSources(true);
    try {
      await window.electron.syncDownloadSources();
      await refreshDownloadSources();

      showSuccessToast(t("download_sources_synced_successfully"));
    } catch (error) {
      logger.error("Failed to sync download sources:", error);
      await refreshDownloadSources();
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
            isRemovingDownloadSource
          }
          onClick={syncDownloadSources}
        >
          <SyncIcon />
          {t("sync_download_sources")}
        </Button>

        <div className="settings-download-sources__buttons-container">
          <Button
            type="button"
            theme="danger"
            onClick={() => setShowConfirmationDeleteAllSourcesModal(true)}
            disabled={
              isRemovingDownloadSource ||
              isSyncingDownloadSources ||
              !downloadSources.length
            }
          >
            <TrashIcon />
            {t("button_delete_all_sources")}
          </Button>

          <Button
            type="button"
            theme="outline"
            onClick={() => setShowAddDownloadSourceModal(true)}
            disabled={isSyncingDownloadSources || isRemovingDownloadSource}
          >
            <PlusCircleIcon />
            {t("add_download_source")}
          </Button>
        </div>
      </div>

      {isLoadingSources ? (
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <p>Loading...</p>
        </div>
      ) : downloadSources.length === 0 ? (
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <p>{t("download_sources_description")}</p>
          <p style={{ marginTop: "1rem", opacity: 0.7 }}>
            {t("add_download_source_description")}
          </p>
        </div>
      ) : (
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
                      disabled={isRemovingDownloadSource}
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
      )}
    </>
  );
}
