import { useEffect, useState } from "react";

import { TextField, Button } from "@renderer/components";
import { useTranslation } from "react-i18next";

import * as styles from "./settings-download-sources.css";
import type { DownloadSource } from "@types";
import { NoEntryIcon, PlusCircleIcon } from "@primer/octicons-react";
import { AddDownloadSourceModal } from "./add-download-source-modal";
import { useToast } from "@renderer/hooks";

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
    showSuccessToast("Removed download source");

    getDownloadSources();
  };

  const handleAddDownloadSource = async () => {
    await getDownloadSources();
    showSuccessToast("Download source successfully added");
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

      <Button
        type="button"
        theme="outline"
        style={{ alignSelf: "flex-start" }}
        onClick={() => setShowAddDownloadSourceModal(true)}
      >
        <PlusCircleIcon />
        {t("add_download_source")}
      </Button>

      {downloadSources.map((downloadSource) => (
        <div key={downloadSource.id} className={styles.downloadSourceItem}>
          <div className={styles.downloadSourceItemHeader}>
            <h3>{downloadSource.name}</h3>
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
        </div>
      ))}
    </>
  );
}
