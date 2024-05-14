import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, Modal, TextField } from "@renderer/components";
import type { GameRepack } from "@types";

import * as styles from "./repacks-modal.css";

import { useAppSelector } from "@renderer/hooks";
import { SPACING_UNIT } from "../../theme.css";
import { format } from "date-fns";
import { SelectFolderModal } from "./select-folder-modal";
import { SeedersAndPeers } from "./seeders-and-peers/seeders-and-peers";
import {
  isMultiplayerRepack,
  supportMultiLanguage,
} from "@renderer/helpers/searcher";
import { Tag } from "@renderer/components/tag/tag";
import { getRepackLanguageBasedOnRepacker } from "../../helpers/searcher";

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
  const { value: userPreferences } = useAppSelector(
    (state) => state.userPreferences
  );

  const repackersFriendlyNames = useAppSelector(
    (state) => state.repackersFriendlyNames.value
  );

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
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                }}
              >
                <div>
                  <p style={{ fontSize: "12px" }}>
                    {repack.fileSize} -{" "}
                    {repackersFriendlyNames[repack.repacker]} -{" "}
                    {repack.uploadDate
                      ? format(repack.uploadDate, "dd/MM/yyyy")
                      : ""}
                    {userPreferences?.language && (
                      <>
                        {" - " +
                          getRepackLanguageBasedOnRepacker(
                            repack.repacker,
                            userPreferences?.language
                          )}
                      </>
                    )}
                  </p>
                </div>
                <SeedersAndPeers repack={repack} />
              </div>
              <div className={styles.tagsContainer}>
                {supportMultiLanguage(repack.title) && (
                  <Tag>{t("multi_language")}</Tag>
                )}
                {isMultiplayerRepack(repack.title, repack.repacker) && (
                  <Tag>{t("multiplayer")}</Tag>
                )}
              </div>
            </Button>
          ))}
        </div>
      </Modal>
    </>
  );
}
