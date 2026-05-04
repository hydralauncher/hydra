import type { GameShop, LibraryGame } from "@types";

import { Badge } from "@renderer/components";
import { buildGameDetailsPath } from "@renderer/helpers";
import { Downloader, formatBytes } from "@shared";
import { DOWNLOADER_NAME } from "@renderer/constants";
import type { useDownload } from "@renderer/hooks";
import { useTranslation } from "react-i18next";
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ClockIcon,
  ColumnsIcon,
  DownloadIcon,
  GraphIcon,
  PeopleIcon,
  PlayIcon,
  XCircleIcon,
} from "@primer/octicons-react";

import { AnimatedPercentage } from "./animated-percentage";
import { SpeedChart } from "./speed-chart";
import { TorrentFilesPanel } from "./torrent-files-panel";
import { heroEnterVariants } from "./download-animations";

interface HeroDownloadViewProps {
  game: LibraryGame;
  isGameDownloading: boolean;
  isGameExtracting?: boolean;
  downloadSpeed: number;
  finalDownloadSize: string;
  peakSpeed: number;
  currentProgress: number;
  dominantColor: string;
  lastPacket: ReturnType<typeof useDownload>["lastPacket"];
  speedHistory: number[];
  formatSpeed: (speed: number) => string;
  calculateETA: () => string | null;
  pauseDownload: (shop: GameShop, objectId: string) => void;
  resumeDownload: (shop: GameShop, objectId: string) => void;
  onCancelClick: (shop: GameShop, objectId: string) => void;
  t: (key: string) => string;
}

export function HeroDownloadView({
  game,
  isGameDownloading,
  isGameExtracting = false,
  downloadSpeed,
  finalDownloadSize,
  peakSpeed,
  currentProgress,
  dominantColor,
  lastPacket,
  speedHistory,
  formatSpeed,
  calculateETA,
  pauseDownload,
  resumeDownload,
  onCancelClick,
  t,
}: Readonly<HeroDownloadViewProps>) {
  const navigate = useNavigate();
  const { t: tGameDetails } = useTranslation("game_details");

  const handleLogoClick = useCallback(() => {
    navigate(buildGameDetailsPath(game));
  }, [navigate, game]);

  const etaText = calculateETA();
  const hasEta =
    isGameDownloading &&
    !isGameExtracting &&
    !lastPacket?.isCheckingFiles &&
    !lastPacket?.isDownloadingMetadata &&
    !!etaText &&
    etaText.trim() !== "" &&
    etaText !== "0";
  const shouldShowEtaPlaceholder =
    isGameDownloading &&
    !isGameExtracting &&
    !lastPacket?.isCheckingFiles &&
    !lastPacket?.isDownloadingMetadata &&
    !hasEta;
  const shouldShowEta = hasEta || shouldShowEtaPlaceholder;

  const isTorrent = game.download?.downloader === Downloader.Torrent;

  return (
    <motion.div
      className="download-group download-group--hero"
      variants={heroEnterVariants}
      initial="hidden"
      animate="visible"
    >
      <div className="download-group__hero-background">
        <img
          src={game.libraryHeroImageUrl || game.libraryImageUrl || ""}
          alt={game.title}
        />
        <div className="download-group__hero-overlay" />
      </div>

      <div className="download-group__hero-content">
        <div className="download-group__hero-action-row">
          <div className="download-group__hero-logo">
            {game.logoImageUrl ? (
              <button
                type="button"
                onClick={handleLogoClick}
                className="download-group__hero-logo-button"
              >
                <img src={game.logoImageUrl} alt={game.title} />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleLogoClick}
                className="download-group__hero-logo-button"
              >
                <h1>{game.title}</h1>
              </button>
            )}
          </div>
        </div>

        <div className="download-group__hero-progress">
          <div className="download-group__progress-row download-group__progress-row--bar">
            <div className="download-group__progress-wrapper">
              <div className="download-group__progress-info-row">
                {isGameExtracting && (
                  <span className="download-group__progress-status">
                    {t("extracting")}
                  </span>
                )}
                {!isGameExtracting && lastPacket?.isDownloadingMetadata && (
                  <span className="download-group__progress-status">
                    {t("downloading_metadata_status")}
                  </span>
                )}
                {!isGameExtracting &&
                  !lastPacket?.isDownloadingMetadata &&
                  lastPacket?.isCheckingFiles && (
                    <span className="download-group__progress-status">
                      {t("checking_files")}
                    </span>
                  )}
                {!isGameExtracting &&
                  !lastPacket?.isDownloadingMetadata &&
                  !lastPacket?.isCheckingFiles && (
                    <span className="download-group__progress-size">
                      <DownloadIcon size={14} />
                      {isGameDownloading && lastPacket
                        ? `${formatBytes(lastPacket.download.bytesDownloaded)} / ${finalDownloadSize}`
                        : `0 B / ${finalDownloadSize}`}
                    </span>
                  )}
                <span className="download-group__progress-percentage download-group__progress-percentage--hero">
                  <AnimatedPercentage value={currentProgress} />
                </span>
              </div>
              <div className="download-group__progress-info-row">
                {!lastPacket?.isCheckingFiles &&
                  !lastPacket?.isDownloadingMetadata &&
                  !isGameExtracting && (
                    <span className="download-group__progress-time">
                      {shouldShowEta && (
                        <>
                          <ClockIcon size={14} />
                          {hasEta ? etaText : tGameDetails("calculating_eta")}
                        </>
                      )}
                    </span>
                  )}
                <span></span>
              </div>
              <div className="download-group__progress-bar">
                <div
                  className={`download-group__progress-fill ${isGameExtracting ? "download-group__progress-fill--extraction" : ""} ${!isGameExtracting && dominantColor !== "#f0f1f7" ? "download-group__progress-fill--glow" : ""}`}
                  style={
                    {
                      width: `${currentProgress * 100}%`,
                      ...(!isGameExtracting && dominantColor !== "#f0f1f7"
                        ? {
                            backgroundColor: dominantColor,
                            "--glow-color": `${dominantColor}80`,
                          }
                        : {}),
                    } as React.CSSProperties
                  }
                />
              </div>
            </div>
            {!isGameExtracting && (
              <div className="download-group__hero-buttons">
                {isGameDownloading ? (
                  <button
                    type="button"
                    onClick={() => pauseDownload(game.shop, game.objectId)}
                    className="download-group__glass-btn"
                  >
                    <ColumnsIcon size={14} />
                    {t("pause")}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => resumeDownload(game.shop, game.objectId)}
                    className="download-group__glass-btn"
                  >
                    <PlayIcon size={14} />
                    {t("resume")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onCancelClick(game.shop, game.objectId)}
                  className="download-group__glass-btn"
                >
                  <XCircleIcon size={14} />
                  {t("cancel")}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="download-group__hero-stats">
          <div className="download-group__stats-column">
            <div className="download-group__stat-item">
              <span style={{ color: dominantColor, display: "flex" }}>
                <DownloadIcon size={16} />
              </span>
              <div className="download-group__stat-content">
                <span className="download-group__stat-label">
                  {t("network")}:
                </span>
                <span className="download-group__stat-value">
                  {isGameDownloading ? formatSpeed(downloadSpeed) : "0 B/s"}
                </span>
              </div>
            </div>

            <div className="download-group__stat-item">
              <span style={{ color: dominantColor, display: "flex" }}>
                <GraphIcon size={16} />
              </span>
              <div className="download-group__stat-content">
                <span className="download-group__stat-label">{t("peak")}:</span>
                <span className="download-group__stat-value">
                  {peakSpeed > 0 ? formatSpeed(peakSpeed) : "0 B/s"}
                </span>
              </div>
            </div>

            {game.download?.downloader !== undefined && (
              <div className="download-group__stat-item">
                <div className="download-group__stat-content">
                  <Badge>
                    {DOWNLOADER_NAME[Number(game.download.downloader)]}
                  </Badge>
                </div>
              </div>
            )}

            {isTorrent && isGameDownloading && lastPacket && (
              <div className="download-group__torrent-seeds-peers">
                <div className="download-group__torrent-inline-stat">
                  <span style={{ color: "#4ade80", display: "flex" }}>
                    <PeopleIcon size={14} />
                  </span>
                  <span className="download-group__torrent-inline-stat-label">
                    {t("seeds")}
                  </span>
                  <span className="download-group__torrent-inline-stat-value download-group__torrent-inline-stat-value--seeds">
                    {lastPacket.numSeeds}
                  </span>
                </div>
                <div className="download-group__torrent-inline-stat">
                  <span className="download-group__torrent-inline-stat-label">
                    {t("peers")}
                  </span>
                  <span className="download-group__torrent-inline-stat-value">
                    {lastPacket.numPeers}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="download-group__speed-chart">
            <SpeedChart
              speeds={speedHistory}
              peakSpeed={peakSpeed}
              color={dominantColor}
            />
          </div>
        </div>

        {isTorrent &&
          !lastPacket?.isDownloadingMetadata &&
          lastPacket?.files &&
          lastPacket.files.length > 0 && (
            <TorrentFilesPanel files={lastPacket.files} />
          )}
      </div>
    </motion.div>
  );
}
