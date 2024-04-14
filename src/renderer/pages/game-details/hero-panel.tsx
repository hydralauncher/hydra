import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import prettyBytes from "pretty-bytes";
import { format } from "date-fns";

import { Button } from "@renderer/components";
import { useDownload, useLibrary } from "@renderer/hooks";
import type { Game, ShopDetails } from "@types";

import * as styles from "./hero-panel.css";
import { formatDownloadProgress } from "@renderer/helpers";
import { BinaryNotFoundModal } from "../shared-modals/binary-not-found-modal";

export interface HeroPanelProps {
  game: Game | null;
  gameDetails: ShopDetails | null;
  color: string;
  openRepacksModal: () => void;
  getGame: () => void;
}

export function HeroPanel({
  game,
  gameDetails,
  color,
  openRepacksModal,
  getGame,
}: HeroPanelProps) {
  const { t } = useTranslation("game_details");

  const [showBinaryNotFoundModal, setShowBinaryNotFoundModal] = useState<boolean>(false);

  const {
    game: gameDownloading,
    isDownloading,
    progress,
    eta,
    numPeers,
    numSeeds,
    resumeDownload,
    pauseDownload,
    cancelDownload,
    deleteGame,
    removeGame,
    isGameDeleting,
  } = useDownload();
  const { updateLibrary } = useLibrary();

  const isGameDownloading = isDownloading && gameDownloading?.id === game?.id;

  const openGame = (gameId: number) =>
    window.electron.openGame(gameId).then(res => {
      if (!res) setShowBinaryNotFoundModal(true);
      updateLibrary();
    });

  const finalDownloadSize = useMemo(() => {
    if (!game) return "N/A";
    if (game.fileSize) return prettyBytes(game.fileSize);

    if (gameDownloading?.fileSize && isGameDownloading)
      return prettyBytes(gameDownloading.fileSize);

    return game.repack?.fileSize ?? "N/A";
  }, [game, isGameDownloading, gameDownloading]);

  const getInfo = () => {
    if (!gameDetails) return null;

    if (isGameDeleting(game?.id)) {
      return <p>{t("deleting")}</p>;
    }

    if (isGameDownloading) {
      return (
        <>
          <p className={styles.downloadDetailsRow}>
            {progress}
            {eta && <small>{t("eta", { eta })}</small>}
          </p>

          {gameDownloading?.status !== "downloading" ? (
            <>
              <p>{t(gameDownloading?.status)}</p>
              {eta && <small>{t("eta", { eta })}</small>}
            </>
          ) : (
            <p className={styles.downloadDetailsRow}>
              {prettyBytes(gameDownloading?.bytesDownloaded)} /{" "}
              {finalDownloadSize}
              <small>
                {numPeers} peers / {numSeeds} seeds
              </small>
            </p>
          )}
        </>
      );
    }

    if (game?.status === "paused") {
      return (
        <>
          <p>
            {t("paused_progress", {
              progress: formatDownloadProgress(game.progress),
            })}
          </p>
          <p>
            {prettyBytes(game.bytesDownloaded)} / {finalDownloadSize}
          </p>
        </>
      );
    }

    const lastUpdate = format(gameDetails.repacks[0].uploadDate!, "dd/MM/yyyy");
    const repacksCount = gameDetails.repacks.length;

    return (
      <>
        <p>{t("updated_at", { updated_at: lastUpdate })}</p>
        <p>{t("download_options", { count: repacksCount })}</p>
      </>
    );
  };

  const getActions = () => {
    const deleting = isGameDeleting(game?.id);

    if (isGameDownloading) {
      return (
        <>
          <Button onClick={() => pauseDownload(game.id)} theme="outline">
            {t("pause")}
          </Button>
          <Button onClick={() => cancelDownload(game.id)} theme="outline">
            {t("cancel")}
          </Button>
        </>
      );
    }

    if (game?.status === "paused") {
      return (
        <>
          <Button onClick={() => resumeDownload(game.id)} theme="outline">
            {t("resume")}
          </Button>
          <Button
            onClick={() => cancelDownload(game.id).then(getGame)}
            theme="outline"
          >
            {t("cancel")}
          </Button>
        </>
      );
    }

    if (game?.status === "seeding") {
      return (
        <>
          <Button
            onClick={() => openGame(game.id)}
            theme="outline"
            disabled={deleting}
          >
            {t("launch")}
          </Button>
          <Button
            onClick={() => deleteGame(game.id).then(getGame)}
            theme="outline"
            disabled={deleting}
          >
            {t("delete")}
          </Button>
        </>
      );
    }

    if (game?.status === "cancelled") {
      return (
        <>
          <Button
            onClick={openRepacksModal}
            theme="outline"
            disabled={deleting}
          >
            {t("open_download_options")}
          </Button>
          <Button
            onClick={() => removeGame(game.id).then(getGame)}
            theme="outline"
            disabled={deleting}
          >
            {t("remove")}
          </Button>
        </>
      );
    }

    return (
      <Button onClick={openRepacksModal} theme="outline">
        {t("open_download_options")}
      </Button>
    );
  };

  return (
    <div style={{ backgroundColor: color }} className={styles.panel}>
      <BinaryNotFoundModal visible={showBinaryNotFoundModal} onClose={() => setShowBinaryNotFoundModal(false)} />
      <div className={styles.content}>{getInfo()}</div>
      <div className={styles.actions}>{getActions()}</div>
    </div>
  );
}
