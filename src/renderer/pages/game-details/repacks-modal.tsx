import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, Modal, TextField } from "@renderer/components";
import type { GameRepack, ShopDetails } from "@types";

import * as styles from "./repacks-modal.css";

import type { DiskSpace } from "check-disk-space";
import { format } from "date-fns";
import { SPACING_UNIT } from "@renderer/theme.css";
import { formatBytes } from "@renderer/utils";
import { useAppSelector } from "@renderer/hooks";
import { SelectFolderModal } from "./select-folder-modal";

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
  const [openSelectFolderModal, setOpenSelectFolderModal] = useState(false);
  const [diskFreeSpace, setDiskFreeSpace] = useState<DiskSpace>(null);
  const [filteredRepacks, setFilteredRepacks] = useState<GameRepack[]>([]);
  const [repack, setRepack] = useState<GameRepack>(null);

  const repackersFriendlyNames = useAppSelector(
    (state) => state.repackersFriendlyNames.value
  );

  const { t } = useTranslation("game_details");

  useEffect(() => {
    setFilteredRepacks(gameDetails.repacks);
  }, [gameDetails.repacks]);

  const getDiskFreeSpace = () => {
    window.electron.getDiskFreeSpace().then((result) => {
      setDiskFreeSpace(result);
    });
  };

  useEffect(() => {
    getDiskFreeSpace();
  }, [visible]);

  const handleRepackClick = (repack: GameRepack) => {
    setRepack(repack);
    setOpenSelectFolderModal(true);
  };

  const handleFilter: React.ChangeEventHandler<HTMLInputElement> = (event) => {
    setFilteredRepacks(
      gameDetails.repacks.filter((repack) =>
        repack.title
          .toLowerCase()
          .includes(event.target.value.toLocaleLowerCase())
      )
    );
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
      <SelectFolderModal
        visible={openSelectFolderModal}
        onClose={() => setOpenSelectFolderModal(false)}
        gameDetails={gameDetails}
        startDownload={startDownload}
        repack={repack}
      />
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
