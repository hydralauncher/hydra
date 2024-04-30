import { Button, Modal, TextField } from "@renderer/components";
import { GameRepack, ShopDetails } from "@types";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatBytes } from "@renderer/utils";
import { DiskSpace } from "check-disk-space";
import { Link } from "react-router-dom";
import * as styles from "./select-folder-modal.css";

export interface SelectFolderModalProps {
  visible: boolean;
  gameDetails: ShopDetails;
  onClose: () => void;
  startDownload: (repackId: number, downloadPath: string) => Promise<void>;
  repack: GameRepack | null;
}

export function SelectFolderModal({
  visible,
  gameDetails,
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
      startDownload(repack.id, selectedPath).finally(() => {
        setDownloadStarting(false);
      });
    }
  };

  return (
    <Modal
      visible={visible}
      title={`${gameDetails.name} Installation folder`}
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
          {t("select_folder_hint")}{" "}
          <Link
            to="/settings"
            style={{
              textDecoration: "none",
              color: "#C0C1C7",
            }}
          >
            {t("settings")}
          </Link>
        </p>
        <Button onClick={handleStartClick} disabled={downloadStarting}>
          {t("download_now")}
        </Button>
      </div>
    </Modal>
  );
}
