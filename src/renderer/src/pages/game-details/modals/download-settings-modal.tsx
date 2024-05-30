import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { DiskSpace } from "check-disk-space";
import * as styles from "./download-settings-modal.css";
import { Button, Link, Modal, TextField } from "@renderer/components";
import { CheckCircleFillIcon, DownloadIcon } from "@primer/octicons-react";
import { Downloader, formatBytes } from "@shared";

import type { GameRepack } from "@types";
import { SPACING_UNIT } from "@renderer/theme.css";
import { DOWNLOADER_NAME } from "@renderer/constants";
import { useAppSelector } from "@renderer/hooks";

export interface DownloadSettingsModalProps {
  visible: boolean;
  onClose: () => void;
  startDownload: (
    repack: GameRepack,
    downloader: Downloader,
    downloadPath: string
  ) => Promise<void>;
  repack: GameRepack | null;
}

const downloaders = [Downloader.Torrent, Downloader.RealDebrid];

export function DownloadSettingsModal({
  visible,
  onClose,
  startDownload,
  repack,
}: DownloadSettingsModalProps) {
  const { t } = useTranslation("game_details");

  const [diskFreeSpace, setDiskFreeSpace] = useState<DiskSpace | null>(null);
  const [selectedPath, setSelectedPath] = useState("");
  const [downloadStarting, setDownloadStarting] = useState(false);
  const [selectedDownloader, setSelectedDownloader] = useState(
    Downloader.Torrent
  );

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  useEffect(() => {
    if (visible) {
      getDiskFreeSpace(selectedPath);
    }
  }, [visible, selectedPath]);

  useEffect(() => {
    if (userPreferences?.downloadsPath) {
      setSelectedPath(userPreferences.downloadsPath);
    } else {
      window.electron
        .getDefaultDownloadsPath()
        .then((defaultDownloadsPath) => setSelectedPath(defaultDownloadsPath));
    }

    if (userPreferences?.realDebridApiToken)
      setSelectedDownloader(Downloader.RealDebrid);
  }, [userPreferences?.downloadsPath, userPreferences?.realDebridApiToken]);

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
      title={t("download_settings")}
      description={t("space_left_on_disk", {
        space: formatBytes(diskFreeSpace?.free ?? 0),
      })}
      onClose={onClose}
    >
      <div className={styles.container}>
        <div>
          <span
            style={{
              marginBottom: `${SPACING_UNIT}px`,
              display: "block",
            }}
          >
            {t("downloader")}
          </span>

          <div className={styles.downloaders}>
            {downloaders.map((downloader) => (
              <Button
                key={downloader}
                className={styles.downloaderOption}
                theme={
                  selectedDownloader === downloader ? "primary" : "outline"
                }
                disabled={
                  downloader === Downloader.RealDebrid &&
                  !userPreferences?.realDebridApiToken
                }
                onClick={() => setSelectedDownloader(downloader)}
              >
                {selectedDownloader === downloader && (
                  <CheckCircleFillIcon className={styles.downloaderIcon} />
                )}
                {DOWNLOADER_NAME[downloader]}
              </Button>
            ))}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: `${SPACING_UNIT}px`,
          }}
        >
          <div className={styles.downloadsPathField}>
            <TextField
              value={selectedPath}
              readOnly
              disabled
              label={t("download_path")}
            />

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
        </div>

        <Button onClick={handleStartClick} disabled={downloadStarting}>
          <DownloadIcon />
          {t("download_now")}
        </Button>
      </div>
    </Modal>
  );
}
