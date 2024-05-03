import { format } from "date-fns";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useDownload } from "@renderer/hooks";
import type { Game, ShopDetails } from "@types";

import { formatDownloadProgress } from "@renderer/helpers";
import { useDate } from "@renderer/hooks/use-date";
import { formatBytes } from "@renderer/utils";
import { HeroPanelActions } from "./hero-panel-actions";

import { BinaryNotFoundModal } from "../../shared-modals/binary-not-found-modal";
import * as styles from "./hero-panel.css";

export interface HeroPanelProps {
  game: Game | null;
  gameDetails: ShopDetails | null;
  color: string;
  isGamePlaying: boolean;
  openRepacksModal: () => void;
  getGame: () => void;
}

const MAX_MINUTES_TO_SHOW_IN_PLAYTIME = 120;

export function HeroPanel({
  game,
  gameDetails,
  color,
  openRepacksModal,
  getGame,
  isGamePlaying,
}: HeroPanelProps) {
  const { t, i18n } = useTranslation("game_details");

  const [showBinaryNotFoundModal, setShowBinaryNotFoundModal] = useState(false);
  const [lastTimePlayed, setLastTimePlayed] = useState("");

  const { formatDistance } = useDate();

  const {
    game: gameDownloading,
    isDownloading,
    progress,
    eta,
    numPeers,
    numSeeds,
    isGameDeleting,
  } = useDownload();
  const isGameDownloading = isDownloading && gameDownloading?.id === game?.id;

  useEffect(() => {
    if (game?.lastTimePlayed) {
      setLastTimePlayed(
        formatDistance(game.lastTimePlayed, new Date(), {
          addSuffix: true,
        })
      );
    }
  }, [game?.lastTimePlayed, formatDistance]);

  const numberFormatter = useMemo(() => {
    return new Intl.NumberFormat(i18n.language, {
      maximumFractionDigits: 1,
    });
  }, [i18n]);

  const formatPlayTime = () => {
    const milliseconds = game?.playTimeInMilliseconds || 0;
    const seconds = milliseconds / 1000;
    const minutes = seconds / 60;

    if (minutes < MAX_MINUTES_TO_SHOW_IN_PLAYTIME) {
      return t("amount_minutes", {
        amount: minutes.toFixed(0),
      });
    }

    const hours = minutes / 60;
    return t("amount_hours", { amount: numberFormatter.format(hours) });
  };

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

    if (isGameDownloading) {
      return (
        <>
          <p className={styles.downloadDetailsRow}>
            {progress}
            {eta && <small>{t("eta", { eta })}</small>}
          </p>

          {gameDownloading?.status !== "downloading" ? (
            <>
              <p>{t(gameDownloading?.status ?? "N/A")}</p>
              {eta && <small>{t("eta", { eta })}</small>}
            </>
          ) : (
            <p className={styles.downloadDetailsRow}>
              {formatBytes(gameDownloading?.bytesDownloaded)} /{" "}
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
            {formatBytes(game.bytesDownloaded)} / {finalDownloadSize}
          </p>
        </>
      );
    }

    if (game?.status === "seeding" || (game && !game.status)) {
      if (!game.lastTimePlayed) {
        return <p>{t("not_played_yet", { title: game.title })}</p>;
      }

      return (
        <>
          <p>
            {t("play_time", {
              amount: formatPlayTime(),
            })}
          </p>

          {isGamePlaying ? (
            <p>{t("playing_now")}</p>
          ) : (
            <p>
              {t("last_time_played", {
                period: lastTimePlayed,
              })}
            </p>
          )}
        </>
      );
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
