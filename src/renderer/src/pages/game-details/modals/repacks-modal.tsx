import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import parseTorrent from "parse-torrent";

import { Badge, Button, Modal, TextField } from "@renderer/components";
import type { GameRepack } from "@types";

import * as styles from "./repacks-modal.css";

import { SPACING_UNIT } from "@renderer/theme.css";
import { format } from "date-fns";
import { DownloadSettingsModal } from "./download-settings-modal";
import { gameDetailsContext } from "@renderer/context";
import { Downloader } from "@shared";
import { orderBy } from "lodash-es";

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

  const [infoHash, setInfoHash] = useState<string | null>(null);

  const { repacks, game } = useContext(gameDetailsContext);

  const { t } = useTranslation("game_details");

  const sortedRepacks = useMemo(() => {
    return orderBy(repacks, (repack) => repack.uploadDate, "desc");
  }, [repacks]);

  const getInfoHash = useCallback(async () => {
    const torrent = await parseTorrent(game?.uri ?? "");

    if (torrent.infoHash) setInfoHash(torrent.infoHash);
  }, [game]);

  useEffect(() => {
    setFilteredRepacks(sortedRepacks);

    if (game?.uri) getInfoHash();
  }, [sortedRepacks, visible, game, getInfoHash]);

  const handleRepackClick = (repack: GameRepack) => {
    setRepack(repack);
    setShowSelectFolderModal(true);
  };

  const handleFilter: React.ChangeEventHandler<HTMLInputElement> = (event) => {
    const term = event.target.value.toLocaleLowerCase();

    setFilteredRepacks(
      sortedRepacks.filter((repack) => {
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
          {filteredRepacks.map((repack) => {
            const isLastDownloadedOption =
              infoHash !== null &&
              repack.magnet.toLowerCase().includes(infoHash);

            return (
              <Button
                key={repack.id}
                theme="dark"
                onClick={() => handleRepackClick(repack)}
                className={styles.repackButton}
              >
                <p style={{ color: "#DADBE1", wordBreak: "break-word" }}>
                  {repack.title}
                </p>

                {isLastDownloadedOption && (
                  <Badge>{t("last_downloaded_option")}</Badge>
                )}

                <p style={{ fontSize: "12px" }}>
                  {repack.fileSize} - {repack.repacker} -{" "}
                  {repack.uploadDate
                    ? format(repack.uploadDate, "dd/MM/yyyy")
                    : ""}
                </p>
              </Button>
            );
          })}
        </div>
      </Modal>
    </>
  );
}
