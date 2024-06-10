import { useCallback, useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import parseTorrent from "parse-torrent";

import { Badge, Button, Modal, TextField } from "@renderer/components";
import type { GameRepack } from "@types";

import * as styles from "./repacks-modal.css";

import { SPACING_UNIT } from "../../../theme.css";
import { format } from "date-fns";
import { DownloadSettingsModal } from "./download-settings-modal";
import { gameDetailsContext } from "../game-details.context";
import { Downloader } from "@shared";
import {
  getRepackLanguageBasedOnRepacker,
  isMultiplayerRepack,
  supportMultiLanguage,
} from "@renderer/helpers/searcher";
import { useAppSelector } from "@renderer/hooks";
import { SeedersAndPeers } from "../seeders-and-peers/seeders-and-peers";

export interface RepacksModalProps {
  visible: boolean;
  startDownload: (
    repack: GameRepack,
    downloader: Downloader,
    downloadPath: string
  ) => Promise<void>;
  onClose: () => void;
}

export function RepacksModal({
  visible,
  startDownload,
  onClose,
}: RepacksModalProps) {
  const [filteredRepacks, setFilteredRepacks] = useState<GameRepack[]>([]);
  const [repack, setRepack] = useState<GameRepack | null>(null);
  const [showSelectFolderModal, setShowSelectFolderModal] = useState(false);
  const { value: userPreferences } = useAppSelector(
    (state) => state.userPreferences
  );

  const [infoHash, setInfoHash] = useState("");

  const { repacks, game } = useContext(gameDetailsContext);

  const { t } = useTranslation("game_details");

  const getInfoHash = useCallback(async () => {
    const torrent = await parseTorrent(game?.uri ?? "");
    setInfoHash(torrent.infoHash ?? "");
  }, [game]);

  useEffect(() => {
    setFilteredRepacks(repacks);

    if (game?.uri) getInfoHash();
  }, [repacks, visible, game, getInfoHash]);

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
      <DownloadSettingsModal
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
              <p style={{ color: "#DADBE1", wordBreak: "break-word" }}>
                {repack.title}
              </p>
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
                    {repack.fileSize} - {repack.repacker} -{" "}
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
                  <Badge>{t("multi_language")}</Badge>
                )}
                {isMultiplayerRepack(repack.title, repack.repacker) && (
                  <Badge>{t("multiplayer")}</Badge>
                )}
              </div>
              {repack.magnet.toLowerCase().includes(infoHash) && (
                <Badge>{t("last_downloaded_option")}</Badge>
              )}
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
