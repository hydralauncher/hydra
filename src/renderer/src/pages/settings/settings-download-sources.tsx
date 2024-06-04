import { useEffect, useState } from "react";

import { TextField, Button, Badge } from "@renderer/components";
import { useTranslation } from "react-i18next";

import * as styles from "./settings-download-sources.css";
import type { DownloadSource } from "@types";
import { NoEntryIcon, PlusCircleIcon, SyncIcon } from "@primer/octicons-react";
import { AddDownloadSourceModal } from "./add-download-source-modal";
import { useToast } from "@renderer/hooks";
import { DownloadSourceStatus } from "@shared";

export function SettingsDownloadSources() {
  const [showAddDownloadSourceModal, setShowAddDownloadSourceModal] =
    useState(false);
  const [downloadSources, setDownloadSources] = useState<DownloadSource[]>([]);

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

  const handleRemoveSource = async (id: number) => {
    await window.electron.removeDownloadSource(id);
    showSuccessToast(t("removed_download_source"));

    getDownloadSources();
  };

  const handleAddDownloadSource = async () => {
    await getDownloadSources();
    showSuccessToast(t("added_download_source"));
  };

  const statusTitle = {
    [DownloadSourceStatus.UpToDate]: t("download_source_up_to_date"),
    [DownloadSourceStatus.Errored]: t("download_source_errored"),
  };

  return (
    <>
      <AddDownloadSourceModal
        visible={showAddDownloadSourceModal}
        onClose={() => setShowAddDownloadSourceModal(false)}
        onAddDownloadSource={handleAddDownloadSource}
      />

      <p style={{ fontFamily: '"Fira Sans"' }}>
        {t("download_sources_description")}
      </p>

      <div className={styles.downloadSourcesHeader}>
        <Button
          type="button"
          theme="outline"
          onClick={() => setShowAddDownloadSourceModal(true)}
        >
          <PlusCircleIcon />
          {t("add_download_source")}
        </Button>

        <Button
          type="button"
          theme="outline"
          disabled={!downloadSources.length}
        >
          <SyncIcon />
          {t("resync_download_sources")}
        </Button>
      </div>

      <ul className={styles.downloadSources}>
        {downloadSources.map((downloadSource) => (
          <li key={downloadSource.id} className={styles.downloadSourceItem}>
            <div className={styles.downloadSourceItemHeader}>
              <h2>{downloadSource.name}</h2>

              <div style={{ display: "flex" }}>
                <Badge>{statusTitle[downloadSource.status]}</Badge>
              </div>

              <small>
                {t("download_options", {
                  count: downloadSource.repackCount,
                  countFormatted: downloadSource.repackCount.toLocaleString(),
                })}
              </small>
            </div>

            <div className={styles.downloadSourceField}>
              <TextField
                label={t("download_source_url")}
                value={downloadSource.url}
                readOnly
                theme="dark"
                disabled
              />

              <Button
                type="button"
                theme="outline"
                style={{ alignSelf: "flex-end" }}
                onClick={() => handleRemoveSource(downloadSource.id)}
              >
                <NoEntryIcon />
                {t("remove_download_source")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
