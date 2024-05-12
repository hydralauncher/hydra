import { format } from "date-fns";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useDownload } from "@renderer/hooks";
import type { Game, ShopDetails } from "@types";

import { formatDownloadProgress } from "@renderer/helpers";
import { HeroPanelActions } from "./hero-panel-actions";
import { Downloader, GameStatus, GameStatusHelper, formatBytes } from "@shared";

import { BinaryNotFoundModal } from "../../shared-modals/binary-not-found-modal";
import * as styles from "./hero-panel.css";
import { HeroPanelPlaytime } from "./hero-panel-playtime";

export interface HeroPanelProps {
  game: Game | null;
  gameDetails: ShopDetails | null;
  color: string;
  isGamePlaying: boolean;
  openRepacksModal: () => void;
  getGame: () => void;
}

export function HeroPanel({
  game,
  gameDetails,
  color,
  openRepacksModal,
  getGame,
  isGamePlaying,
}: HeroPanelProps) {
  const { t } = useTranslation("game_details");

  const [showBinaryNotFoundModal, setShowBinaryNotFoundModal] = useState(false);

  const {
    game: gameDownloading,
    progress,
    eta,
    numPeers,
    numSeeds,
    isGameDeleting,
  } = useDownload();

  const isGameDownloading =
    gameDownloading?.id === game?.id &&
    GameStatusHelper.isDownloading(game?.status ?? null);

  const finalDownloadSize = useMemo(() => {
    if (!game) return "N/A";
    if (game.fileSize) return formatBytes(game.fileSize);

    if (gameDownloading?.fileSize && isGameDownloading)
      return formatBytes(gameDownloading.fileSize);

    return game.repack?.fileSize ?? "N/A";
  }, [game, isGameDownloading, gameDownloading]);

  const getInfo = () => {
    if (!gameDetails) return null;

    if (isGameDeleting(game?.id ?? -1)) {
      return <p>{t("deleting")}</p>;
    }

    if (isGameDownloading && gameDownloading?.status) {
      return (
        <>
          <p className={styles.downloadDetailsRow}>
            {progress}
            {eta && <small>{t("eta", { eta })}</small>}
          </p>

          {gameDownloading.status !== GameStatus.Downloading ? (
            <>
              <p>{t(gameDownloading.status)}</p>
              {eta && <small>{t("eta", { eta })}</small>}
            </>
          ) : (
            <p className={styles.downloadDetailsRow}>
              {formatBytes(gameDownloading.bytesDownloaded)} /{" "}
              {finalDownloadSize}
              <small>
                {game?.downloader === Downloader.Torrent &&
                  `${numPeers} peers / ${numSeeds} seeds`}
              </small>
            </p>
          )}
        </>
      );
    }

    if (game?.status === GameStatus.Paused) {
      return (
        <>
          <p>
            {t("paused_progress", {
              progress: formatDownloadProgress(game.progress),
            })}
          </p>
          <p>
            {formatBytes(game.bytesDownloaded)} / {finalDownloadSize}
          </p>
        </>
      );
    }

    if (game && GameStatusHelper.isReady(game?.status ?? null)) {
      return <HeroPanelPlaytime game={game} isGamePlaying={isGamePlaying} />;
    }

    const [latestRepack] = gameDetails.repacks;

    if (latestRepack) {
      const lastUpdate = format(latestRepack.uploadDate!, "dd/MM/yyyy");
      const repacksCount = gameDetails.repacks.length;

      return (
        <>
          <p>{t("updated_at", { updated_at: lastUpdate })}</p>
          <p>{t("download_options", { count: repacksCount })}</p>
        </>
      );
    }

    return <p>{t("no_downloads")}</p>;
  };

  return (
    <>
      <BinaryNotFoundModal
        visible={showBinaryNotFoundModal}
        onClose={() => setShowBinaryNotFoundModal(false)}
      />

      <div style={{ backgroundColor: color }} className={styles.panel}>
        <div className={styles.content}>{getInfo()}</div>
        <div className={styles.actions}>
          <HeroPanelActions
            game={game}
            gameDetails={gameDetails}
            getGame={getGame}
            openRepacksModal={openRepacksModal}
            openBinaryNotFoundModal={() => setShowBinaryNotFoundModal(true)}
            isGamePlaying={isGamePlaying}
            isGameDownloading={isGameDownloading}
          />
        </div>
      </div>
    </>
  );
}
