import { useContext, useEffect, useState } from "react";

import { TextField, Button, Badge } from "@renderer/components";
import { useTranslation } from "react-i18next";

import * as styles from "./settings-download-sources.css";
import type { DownloadSource } from "@types";
import { NoEntryIcon, PlusCircleIcon, SyncIcon } from "@primer/octicons-react";
import { AddDownloadSourceModal } from "./add-download-source-modal";
import { useToast } from "@renderer/hooks";
import { DownloadSourceStatus } from "@shared";
import { SPACING_UNIT } from "@renderer/theme.css";
import { settingsContext } from "@renderer/context";

export function SettingsDownloadSources() {
  const [showAddDownloadSourceModal, setShowAddDownloadSourceModal] =
    useState(false);
  const [downloadSources, setDownloadSources] = useState<DownloadSource[]>([]);
  const [isSyncingDownloadSources, setIsSyncingDownloadSources] =
    useState(false);

  const { sourceUrl, clearSourceUrl } = useContext(settingsContext);

  const { t } = useTranslation("settings");
  const { showSuccessToast } = useToast();

  const getDownloadSources = async () => {
    return window.electron.getDownloadSources().then((sources) => {
      setDownloadSources(sources);
    });
  };

  useEffect(() => {
    getDownloadSources();
  }, []);

  useEffect(() => {
    if (sourceUrl) setShowAddDownloadSourceModal(true);
  }, [sourceUrl]);

  const handleRemoveSource = async (id: number) => {
    await window.electron.removeDownloadSource(id);
    showSuccessToast(t("removed_download_source"));

    getDownloadSources();
  };

  const handleAddDownloadSource = async () => {
    await getDownloadSources();
    showSuccessToast(t("added_download_source"));
  };

  const syncDownloadSources = async () => {
    setIsSyncingDownloadSources(true);

    window.electron
      .syncDownloadSources()
      .then(() => {
        showSuccessToast(t("download_sources_synced"));
        getDownloadSources();
      })
      .finally(() => {
        setIsSyncingDownloadSources(false);
      });
  };

  const statusTitle = {
    [DownloadSourceStatus.UpToDate]: t("download_source_up_to_date"),
    [DownloadSourceStatus.Errored]: t("download_source_errored"),
  };

  const handleModalClose = () => {
    clearSourceUrl();
    setShowAddDownloadSourceModal(false);
  };

  return (
    <>
      <AddDownloadSourceModal
        visible={showAddDownloadSourceModal}
        onClose={handleModalClose}
        onAddDownloadSource={handleAddDownloadSource}
      />

      <p>{t("download_sources_description")}</p>

      <div className={styles.downloadSourcesHeader}>
        <Button
          type="button"
          theme="outline"
          disabled={!downloadSources.length || isSyncingDownloadSources}
          onClick={syncDownloadSources}
        >
          <SyncIcon />
          {t("sync_download_sources")}
        </Button>

        <Button
          type="button"
          theme="outline"
          onClick={() => setShowAddDownloadSourceModal(true)}
        >
          <PlusCircleIcon />
          {t("add_download_source")}
        </Button>
      </div>

      <ul className={styles.downloadSources}>
        {downloadSources.map((downloadSource) => (
          <li
            key={downloadSource.id}
            className={styles.downloadSourceItem({
              isSyncing: isSyncingDownloadSources,
            })}
          >
            <div className={styles.downloadSourceItemHeader}>
              <h2>{downloadSource.name}</h2>

              <div style={{ display: "flex" }}>
                <Badge>{statusTitle[downloadSource.status]}</Badge>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: `${SPACING_UNIT}px`,
                }}
              >
                <small>
                  {t("download_count", {
                    count: downloadSource.downloadCount,
                    countFormatted:
                      downloadSource.downloadCount.toLocaleString(),
                  })}
                </small>

                <div className={styles.separator} />

                <small>
                  {t("download_options", {
                    count: downloadSource.repackCount,
                    countFormatted: downloadSource.repackCount.toLocaleString(),
                  })}
                </small>
              </div>
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
                  onClick={() => handleRemoveSource(downloadSource.id)}
                >
                  <NoEntryIcon />
                  {t("remove_download_source")}
                </Button>
              }
            />
          </li>
        ))}
      </ul>
    </>
  );
}
