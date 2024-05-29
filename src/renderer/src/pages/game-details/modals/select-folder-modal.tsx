import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { DiskSpace } from "check-disk-space";
import * as styles from "./select-folder-modal.css";
import { Button, Link, Modal, TextField } from "@renderer/components";
import { CheckCircleFillIcon, DownloadIcon } from "@primer/octicons-react";
import { Downloader, formatBytes } from "@shared";

import type { GameRepack, UserPreferences } from "@types";

export interface SelectFolderModalProps {
  visible: boolean;
  onClose: () => void;
  startDownload: (
    repack: GameRepack,
    downloader: Downloader,
    downloadPath: string
  ) => Promise<void>;
  repack: GameRepack | null;
}

export function SelectFolderModal({
  visible,
  onClose,
  startDownload,
  repack,
}: SelectFolderModalProps) {
  const { t } = useTranslation("game_details");

  const [diskFreeSpace, setDiskFreeSpace] = useState<DiskSpace | null>(null);
  const [selectedPath, setSelectedPath] = useState("");
  const [downloadStarting, setDownloadStarting] = useState(false);
  const [userPreferences, setUserPreferences] =
    useState<UserPreferences | null>(null);
  const [selectedDownloader, setSelectedDownloader] = useState(
    Downloader.Torrent
  );

  useEffect(() => {
    visible && getDiskFreeSpace(selectedPath);
  }, [visible, selectedPath]);

  useEffect(() => {
    Promise.all([
      window.electron.getDefaultDownloadsPath(),
      window.electron.getUserPreferences(),
    ]).then(([path, userPreferences]) => {
      setSelectedPath(userPreferences?.downloadsPath || path);
      setUserPreferences(userPreferences);

      if (userPreferences?.realDebridApiToken) {
        setSelectedDownloader(Downloader.RealDebrid);
      }
    });
  }, []);

  const getDiskFreeSpace = (path: string) => {
    window.electron.getDiskFreeSpace(path).then((result) => {
      setDiskFreeSpace(result);
    });
  };

  const handleChooseDownloadsPath = async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      defaultPath: selectedPath,
      properties: ["openDirectory"],
    });

    if (filePaths && filePaths.length > 0) {
      const path = filePaths[0];
      setSelectedPath(path);
    }
  };

  const handleStartClick = () => {
    if (repack) {
      setDownloadStarting(true);

      startDownload(repack, selectedDownloader, selectedPath).finally(() => {
        setDownloadStarting(false);
        onClose();
      });
    }
  };

  return (
    <Modal
      visible={visible}
      title="Download options"
      description={t("space_left_on_disk", {
        space: formatBytes(diskFreeSpace?.free ?? 0),
      })}
      onClose={onClose}
    >
      <div className={styles.container}>
        <div>
          <label style={{ marginBottom: 0, padding: 0 }}>Method</label>

          <div className={styles.downloaders}>
            <Button
              className={styles.downloaderOption}
              theme={
                selectedDownloader === Downloader.Torrent
                  ? "primary"
                  : "outline"
              }
              onClick={() => setSelectedDownloader(Downloader.Torrent)}
            >
              {selectedDownloader === Downloader.Torrent && (
                <CheckCircleFillIcon />
              )}
              Torrent
            </Button>
            <Button
              className={styles.downloaderOption}
              theme={
                selectedDownloader === Downloader.RealDebrid
                  ? "primary"
                  : "outline"
              }
              onClick={() => setSelectedDownloader(Downloader.RealDebrid)}
              disabled={!userPreferences?.realDebridApiToken}
            >
              {selectedDownloader === Downloader.RealDebrid && (
                <CheckCircleFillIcon />
              )}
              Real-Debrid
            </Button>
          </div>
        </div>

        <div className={styles.downloadsPathField}>
          <TextField value={selectedPath} readOnly disabled label="Path" />

          <Button
            style={{ alignSelf: "flex-end" }}
            theme="outline"
            onClick={handleChooseDownloadsPath}
            disabled={downloadStarting}
          >
            {t("change")}
          </Button>
        </div>

        <p className={styles.hintText}>
          <Trans i18nKey="select_folder_hint" ns="game_details">
            <Link to="/settings" />
          </Trans>
        </p>

        <Button onClick={handleStartClick} disabled={downloadStarting}>
          <DownloadIcon />
          {t("download_now")}
        </Button>
      </div>
    </Modal>
  );
}
