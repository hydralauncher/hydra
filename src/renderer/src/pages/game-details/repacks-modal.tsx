import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, Modal, TextField } from "@renderer/components";
import type { GameRepack } from "@types";

import * as styles from "./repacks-modal.css";

import { SPACING_UNIT } from "../../theme.css";
import { format } from "date-fns";
import { SelectFolderModal } from "./select-folder-modal";

export interface RepacksModalProps {
  visible: boolean;
  repacks: GameRepack[];
  startDownload: (repack: GameRepack, downloadPath: string) => Promise<void>;
  onClose: () => void;
}

export function RepacksModal({
  visible,
  repacks,
  startDownload,
  onClose,
}: RepacksModalProps) {
  const [filteredRepacks, setFilteredRepacks] = useState<GameRepack[]>([]);
  const [repack, setRepack] = useState<GameRepack | null>(null);
  const [showSelectFolderModal, setShowSelectFolderModal] = useState(false);

  const { t } = useTranslation("game_details");

  useEffect(() => {
    setFilteredRepacks(repacks);
  }, [repacks, visible]);

  const handleRepackClick = (repack: GameRepack) => {
    setRepack(repack);
    setShowSelectFolderModal(true);
  };

  const handleFilter: React.ChangeEventHandler<HTMLInputElement> = (event) => {
    const term = event.target.value.toLocaleLowerCase();

    setFilteredRepacks(
      repacks.filter((repack) => {
        const lowerCaseTitle = repack.title.toLowerCase();
        const lowerCaseRepacker = repack.repacker.toLowerCase();

        return [lowerCaseTitle, lowerCaseRepacker].some((value) =>
          value.includes(term)
        );
      })
    );
  };

  return (
    <>
      <SelectFolderModal
        visible={showSelectFolderModal}
        onClose={() => setShowSelectFolderModal(false)}
        startDownload={startDownload}
        repack={repack}
      />

      <Modal
        visible={visible}
        title={t("download_options")}
        description={t("repacks_modal_description")}
        onClose={onClose}
      >
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
                {repack.fileSize} - {repack.repacker} -{" "}
                {repack.uploadDate
                  ? format(repack.uploadDate, "dd/MM/yyyy")
                  : ""}
              </p>
            </Button>
          ))}
        </div>
      </Modal>
    </>
  );
}
