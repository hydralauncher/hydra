import { useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Badge,
  Button,
  DebridBadge,
  Modal,
  TextField,
} from "@renderer/components";
import type { GameRepack } from "@types";

import { DownloadSettingsModal } from "./download-settings-modal";
import { gameDetailsContext } from "@renderer/context";
import { Downloader } from "@shared";
import { orderBy } from "lodash-es";
import { useDate, useFeature } from "@renderer/hooks";
import "./repacks-modal.scss";

export interface RepacksModalProps {
  visible: boolean;
  startDownload: (
    repack: GameRepack,
    downloader: Downloader,
    downloadPath: string,
    automaticallyExtract: boolean
  ) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}

export function RepacksModal({
  visible,
  startDownload,
  onClose,
}: Readonly<RepacksModalProps>) {
  const [filteredRepacks, setFilteredRepacks] = useState<GameRepack[]>([]);
  const [repack, setRepack] = useState<GameRepack | null>(null);
  const [showSelectFolderModal, setShowSelectFolderModal] = useState(false);

  const [hashesInDebrid, setHashesInDebrid] = useState<Record<string, boolean>>(
    {}
  );

  const { repacks, game } = useContext(gameDetailsContext);

  const { t } = useTranslation("game_details");

  const { formatDate } = useDate();

  const getHashFromMagnet = (magnet: string) => {
    if (!magnet || typeof magnet !== "string") {
      return null;
    }

    const hashRegex = /xt=urn:btih:([a-zA-Z0-9]+)/i;
    const match = magnet.match(hashRegex);

    return match ? match[1].toLowerCase() : null;
  };

  const { isFeatureEnabled, Feature } = useFeature();

  useEffect(() => {
    if (!isFeatureEnabled(Feature.NimbusPreview)) {
      return;
    }

    const magnets = repacks.flatMap((repack) =>
      repack.uris.filter((uri) => uri.startsWith("magnet:"))
    );

    window.electron.checkDebridAvailability(magnets).then((availableHashes) => {
      setHashesInDebrid(availableHashes);
    });
  }, [repacks, isFeatureEnabled, Feature]);

  const sortedRepacks = useMemo(() => {
    return orderBy(
      repacks,
      [
        (repack) => {
          const magnet = repack.uris.find((uri) => uri.startsWith("magnet:"));
          const hash = magnet ? getHashFromMagnet(magnet) : null;
          return hash ? (hashesInDebrid[hash] ?? false) : false;
        },
        (repack) => repack.uploadDate,
      ],
      ["desc", "desc"]
    );
  }, [repacks, hashesInDebrid]);

  useEffect(() => {
    setFilteredRepacks(sortedRepacks);
  }, [sortedRepacks, visible, game]);

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

  const checkIfLastDownloadedOption = (repack: GameRepack) => {
    if (!game?.download) return false;
    return repack.uris.some((uri) => uri.includes(game.download!.uri));
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
        <div className="repacks-modal__filter-container">
          <TextField placeholder={t("filter")} onChange={handleFilter} />
        </div>

        <div className="repacks-modal__repacks">
          {filteredRepacks.map((repack) => {
            const isLastDownloadedOption = checkIfLastDownloadedOption(repack);

            return (
              <Button
                key={repack.id}
                theme="dark"
                onClick={() => handleRepackClick(repack)}
                className="repacks-modal__repack-button"
              >
                <p className="repacks-modal__repack-title">{repack.title}</p>

                {isLastDownloadedOption && (
                  <Badge>{t("last_downloaded_option")}</Badge>
                )}

                <p className="repacks-modal__repack-info">
                  {repack.fileSize} - {repack.repacker} -{" "}
                  {repack.uploadDate ? formatDate(repack.uploadDate) : ""}
                </p>

                {hashesInDebrid[getHashFromMagnet(repack.uris[0]) ?? ""] && (
                  <DebridBadge />
                )}
              </Button>
            );
          })}
        </div>
      </Modal>
    </>
  );
}