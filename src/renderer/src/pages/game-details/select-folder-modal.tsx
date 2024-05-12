import { Button, Link, Modal, TextField } from "@renderer/components";
import type { GameRepack } from "@types";
import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { DiskSpace } from "check-disk-space";
import * as styles from "./select-folder-modal.css";
import { DownloadIcon } from "@primer/octicons-react";
import { formatBytes } from "@shared";

export interface SelectFolderModalProps {
  visible: boolean;
  onClose: () => void;
  startDownload: (repack: GameRepack, downloadPath: string) => Promise<void>;
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

  useEffect(() => {
    visible && getDiskFreeSpace(selectedPath);
  }, [visible, selectedPath]);

  useEffect(() => {
    Promise.all([
      window.electron.getDefaultDownloadsPath(),
      window.electron.getUserPreferences(),
    ]).then(([path, userPreferences]) => {
      setSelectedPath(userPreferences?.downloadsPath || path);
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

      startDownload(repack, selectedPath).finally(() => {
        setDownloadStarting(false);
        onClose();
      });
    }
  };

  return (
    <Modal
      visible={visible}
      title={t("installation_folder")}
      description={t("space_left_on_disk", {
        space: formatBytes(diskFreeSpace?.free ?? 0),
      })}
      onClose={onClose}
    >
      <div className={styles.container}>
        <div className={styles.downloadsPathField}>
          <TextField
            label={t("downloads_path")}
            value={selectedPath}
            readOnly
            disabled
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
        <Button onClick={handleStartClick} disabled={downloadStarting}>
          <DownloadIcon />
          {t("download_now")}
        </Button>
      </div>
    </Modal>
  );
}
