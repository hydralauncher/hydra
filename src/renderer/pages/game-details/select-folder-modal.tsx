import { Button, Modal, TextField } from "@renderer/components";
import { GameRepack, ShopDetails } from "@types";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import * as styles from "./select-folder-modal.css";
import { Link } from "react-router-dom";

export interface SelectFolderModalProps {
  visible: boolean;
  gameDetails: ShopDetails;
  onClose: () => void;
  startDownload: (repackId: number, downloadPath: string) => Promise<void>;
  repack: GameRepack;
}

export function SelectFolderModal({
  visible,
  gameDetails,
  onClose,
  startDownload,
  repack,
}: SelectFolderModalProps) {
  const { t } = useTranslation("game_details");

  const [selectedPath, setSelectedPath] = useState(null);
  const [downloadStarting, setDownloadStarting] = useState(false);

  useEffect(() => {
    Promise.all([
      window.electron.getDefaultDownloadsPath(),
      window.electron.getUserPreferences(),
    ]).then(([path, userPreferences]) => {
      setSelectedPath(userPreferences?.downloadsPath || path);
    });
  }, []);

  const handleChooseDownloadsPath = async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      defaultPath: selectedPath.downloadsPath,
      properties: ["openDirectory"],
    });

    if (filePaths && filePaths.length > 0) {
      const path = filePaths[0];
      setSelectedPath(path);
    }
  };

  const handleStartClick = () => {
    setDownloadStarting(true);
    startDownload(repack.id, selectedPath.downloadsPath).finally(() => {
      setDownloadStarting(false);
    });
  };

  return (
    <Modal
      visible={visible}
      title={`${gameDetails.name} Installation folder`}
      description={t("select_folder_description")}
      onClose={onClose}
    >
      <div className={styles.container}>
        <div className={styles.downloadsPathField}>
          <TextField
            label={t("downloads_path")}
            value={selectedPath.downloadsPath}
            readOnly
            disabled
          />

          <Button
            style={{ alignSelf: "flex-end" }}
            theme="outline"
            onClick={handleChooseDownloadsPath}
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
            {t("hydra_settings")}
          </Link>
        </p>
        <Button onClick={handleStartClick} disabled={downloadStarting}>
          {t("download_now")}
        </Button>
      </div>
    </Modal>
  );
}
