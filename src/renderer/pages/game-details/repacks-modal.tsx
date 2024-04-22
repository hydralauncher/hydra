import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, Modal, TextField } from "@renderer/components";
import type { GameRepack, ShopDetails } from "@types";

import * as styles from "./repacks-modal.css";

import { useAppSelector } from "@renderer/hooks";
import { SPACING_UNIT } from "@renderer/theme.css";
import { format } from "date-fns";
import { SelectFolderModal } from "./select-folder-modal";

export interface RepacksModalProps {
  visible: boolean;
  gameDetails: ShopDetails;
  showSelectFolderModal: boolean;
  setShowSelectFolderModal: (value: boolean) => void;
  startDownload: (repackId: number, downloadPath: string) => Promise<void>;
  onClose: () => void;
}

export function RepacksModal({
  visible,
  gameDetails,
  showSelectFolderModal,
  setShowSelectFolderModal,
  startDownload,
  onClose,
}: RepacksModalProps) {
  const [filteredRepacks, setFilteredRepacks] = useState<GameRepack[]>([]);
  const [repack, setRepack] = useState<GameRepack>(null);

  const repackersFriendlyNames = useAppSelector(
    (state) => state.repackersFriendlyNames.value
  );

  const { t } = useTranslation("game_details");

  useEffect(() => {
    setFilteredRepacks(gameDetails.repacks);
  }, [gameDetails.repacks]);

  const handleRepackClick = (repack: GameRepack) => {
    setRepack(repack);
    setShowSelectFolderModal(true);
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
      description={t("repacks_modal_description")}
      onClose={onClose}
    >
      <SelectFolderModal
        visible={showSelectFolderModal}
        onClose={() => setShowSelectFolderModal(false)}
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
