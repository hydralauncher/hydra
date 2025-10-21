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
import { settingsContext } from "@renderer/context";
import { useNavigate } from "react-router-dom";
import { setFilters, clearFilters } from "@renderer/features";
import "./settings-download-sources.scss";

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

  const { sourceUrl, clearSourceUrl } = useContext(settingsContext);

  const { t } = useTranslation("settings");
  const { showSuccessToast } = useToast();

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

  const handleRemoveSource = async (downloadSource: DownloadSource) => {
    setIsRemovingDownloadSource(true);

    try {
      await window.electron.removeDownloadSource(false, downloadSource.id);
      const sources = await window.electron.getDownloadSources();
      setDownloadSources(sources as DownloadSource[]);
      showSuccessToast(t("removed_download_source"));
    } catch (error) {
      console.error("Failed to remove download source:", error);
    } finally {
      setIsRemovingDownloadSource(false);
    }
  };

  const handleRemoveAllDownloadSources = async () => {
    setIsRemovingDownloadSource(true);

    try {
      await window.electron.removeDownloadSource(true);
      const sources = await window.electron.getDownloadSources();
      setDownloadSources(sources as DownloadSource[]);
      showSuccessToast(t("removed_all_download_sources"));
    } catch (error) {
      console.error("Failed to remove all download sources:", error);
    } finally {
      setIsRemovingDownloadSource(false);
      setShowConfirmationDeleteAllSourcesModal(false);
    }
  };

  const handleAddDownloadSource = async () => {
    try {
      const sources = await window.electron.getDownloadSources();
      setDownloadSources(sources as DownloadSource[]);
    } catch (error) {
      console.error("Failed to refresh download sources:", error);
    }
  };

  const syncDownloadSources = async () => {
    setIsSyncingDownloadSources(true);
    try {
      const sources = await window.electron.syncDownloadSources();
      setDownloadSources(sources);
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
      console.error("Cannot navigate: fingerprint is undefined");
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

      <ul className="settings-download-sources__list">
        {downloadSources.map((downloadSource) => {
          return (
            <li
              key={downloadSource.id}
              className={`settings-download-sources__item ${isSyncingDownloadSources ? "settings-download-sources__item--syncing" : ""}`}
            >
              <div className="settings-download-sources__item-header">
                <h2>{downloadSource.name}</h2>

                <div style={{ display: "flex" }}>
                  <Badge>{statusTitle[downloadSource.status]}</Badge>
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
                    {t("download_count", {
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
    </>
  );
}
