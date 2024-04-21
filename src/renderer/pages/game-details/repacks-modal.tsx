import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, Modal, TextField } from "@renderer/components";
import type { GameRepack, ShopDetails } from "@types";

import * as styles from "./repacks-modal.css";

import { useAppSelector } from "@renderer/hooks";
import { SPACING_UNIT } from "@renderer/theme.css";
import { formatBytes } from "@renderer/utils";
import type { DiskSpace } from "check-disk-space";
import { format } from "date-fns";
import { Link } from "react-router-dom";

export interface RepacksModalProps {
  visible: boolean;
  gameDetails: ShopDetails;
  startDownload: (repackId: number, downloadPath: string) => Promise<void>;
  onClose: () => void;
}

export function RepacksModal({
  visible,
  gameDetails,
  startDownload,
  onClose,
}: RepacksModalProps) {
  const [diskFreeSpace, setDiskFreeSpace] = useState<DiskSpace>(null);
  const [filteredRepacks, setFilteredRepacks] = useState<GameRepack[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [downloadStarting, setDownloadStarting] = useState(false);

  const { t } = useTranslation("game_details");

  useEffect(() => {
    setFilteredRepacks(gameDetails.repacks);
  }, [gameDetails.repacks]);

  useEffect(() => {
    visible && getDiskFreeSpace(selectedPath);
  }, [selectedPath, visible]);

  useEffect(() => {
    Promise.all([
      window.electron.getDefaultDownloadsPath(),
      window.electron.getUserPreferences(),
    ]).then(([path, userPreferences]) => {
      setSelectedPath(userPreferences?.downloadsPath || path);
    });
  }, []);

  const repackersFriendlyNames = useAppSelector(
    (state) => state.repackersFriendlyNames.value
  );

  const handleFilter: React.ChangeEventHandler<HTMLInputElement> = (event) => {
    setFilteredRepacks(
      gameDetails.repacks.filter((repack) =>
        repack.title
          .toLowerCase()
          .includes(event.target.value.toLocaleLowerCase())
      )
    );
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

  const handleRepackClick = (repack: GameRepack) => {
    setDownloadStarting(true);
    startDownload(repack.id, selectedPath).finally(() => {
      setDownloadStarting(false);
    });
  };

  const getDiskFreeSpace = (path: string) => {
    window.electron.getDiskFreeSpace(path).then((result) => {
      setDiskFreeSpace(result);
    });
  };

  return (
    <Modal
      visible={visible}
      title={`${gameDetails.name} Repacks`}
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
            {t("hydra_settings")}
          </Link>
        </p>
      </div>
      <div style={{ marginBottom: `${SPACING_UNIT * 2}px` }}>
        <TextField placeholder={t("filter")} onChange={handleFilter} />
      </div>

      <div className={styles.repacks}>
        {filteredRepacks.map((repack) => (
          <Button
            key={repack.id}
            theme="dark"
            onClick={() => handleRepackClick(repack)}
            className={styles.repackButton}
            disabled={downloadStarting}
          >
            <p style={{ color: "#DADBE1" }}>{repack.title}</p>
            <p style={{ fontSize: "12px" }}>
              {repack.fileSize} - {repackersFriendlyNames[repack.repacker]} -{" "}
              {format(repack.uploadDate, "dd/MM/yyyy")}
            </p>
          </Button>
        ))}
      </div>
    </Modal>
  );
}
