import { format } from "date-fns";
import { useContext, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Color from "color";

import { useDownload } from "@renderer/hooks";

import { formatDownloadProgress } from "@renderer/helpers";
import { HeroPanelActions } from "./hero-panel-actions";
import { Downloader, formatBytes } from "@shared";

import { BinaryNotFoundModal } from "../../shared-modals/binary-not-found-modal";
import * as styles from "./hero-panel.css";
import { HeroPanelPlaytime } from "./hero-panel-playtime";
import { gameDetailsContext } from "../game-details.context";

export function HeroPanel() {
  const { t } = useTranslation("game_details");

  const { game, repacks, gameColor } = useContext(gameDetailsContext);

  const [showBinaryNotFoundModal, setShowBinaryNotFoundModal] = useState(false);

  const { progress, eta, lastPacket, isGameDeleting } = useDownload();

  const finalDownloadSize = useMemo(() => {
    if (!game) return "N/A";
    if (game.fileSize) return formatBytes(game.fileSize);

    if (lastPacket?.game.fileSize && game?.status === "active")
      return formatBytes(lastPacket?.game.fileSize);

    return game.repack?.fileSize ?? "N/A";
  }, [game, lastPacket?.game]);

  const getInfo = () => {
    if (isGameDeleting(game?.id ?? -1)) return <p>{t("deleting")}</p>;

    if (game?.progress === 1) return <HeroPanelPlaytime />;

    if (game?.status === "active") {
      if (lastPacket?.downloadingMetadata) {
        return <p>{t("downloading_metadata")}</p>;
      }

      return (
        <>
          <p className={styles.downloadDetailsRow}>
            {progress}
            {eta && <small>{t("eta", { eta })}</small>}
          </p>

          <p className={styles.downloadDetailsRow}>
            {formatBytes(lastPacket?.game?.bytesDownloaded ?? 0)} /{" "}
            {finalDownloadSize}
            {game?.downloader === Downloader.Torrent && (
              <small>
                {lastPacket?.numPeers} peers / {lastPacket?.numSeeds} seeds
              </small>
            )}
          </p>
        </>
      );
    }

    if (game?.status === "paused") {
      const formattedProgress = formatDownloadProgress(game.progress);

      return (
        <>
          <p>{t("paused_progress", { progress: formattedProgress })}</p>
          <p>
            {formatBytes(game.bytesDownloaded)} / {finalDownloadSize}
          </p>
        </>
      );
    }

    const [latestRepack] = repacks;

    if (latestRepack) {
      const lastUpdate = format(latestRepack.uploadDate!, "dd/MM/yyyy");
      const repacksCount = repacks.length;

      return (
        <>
          <p>{t("updated_at", { updated_at: lastUpdate })}</p>
          <p>{t("download_options", { count: repacksCount })}</p>
        </>
      );
    }

    return <p>{t("no_downloads")}</p>;
  };

  const backgroundColor = gameColor
    ? (new Color(gameColor).darken(0.6).toString() as string)
    : "";

  return (
    <>
      <BinaryNotFoundModal
        visible={showBinaryNotFoundModal}
        onClose={() => setShowBinaryNotFoundModal(false)}
      />

      <div style={{ backgroundColor }} className={styles.panel}>
        <div className={styles.content}>{getInfo()}</div>
        <div className={styles.actions}>
          <HeroPanelActions
            openBinaryNotFoundModal={() => setShowBinaryNotFoundModal(true)}
          />
        </div>
      </div>
    </>
  );
}
