import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import type { LibraryGame } from "@types";
import { formatBytes, formatBytesToMbps } from "@shared";
import { useAppSelector, useDate } from "@renderer/hooks";
import { addMilliseconds } from "date-fns";
import { DownloadsSpeedChart } from "./downloads-speed-chart";
import { DownloadsHeroMetrics } from "./downloads-hero-metrics";
import { DownloadsHeroProgress } from "./downloads-hero-progress";
import { useActiveDownloadInfo } from "./use-active-download-info";
import "./downloads-hero.scss";

interface DownloadsHeroProps {
  activeGame: LibraryGame | null;
  networkHistory: number[];
  diskHistory: number[];
  peakSpeed: number;
  currentNetworkSpeed: number;
  currentDiskSpeed: number;
  onPause: (game: LibraryGame) => void;
  onResume: (game: LibraryGame) => void;
  onCancel: (game: LibraryGame) => void;
}

export function DownloadsHero({
  activeGame,
  networkHistory,
  diskHistory,
  peakSpeed,
  currentNetworkSpeed,
  currentDiskSpeed,
  onPause,
  onResume,
  onCancel,
}: Readonly<DownloadsHeroProps>) {
  const { t } = useTranslation("downloads");
  const { formatDistance } = useDate();
  const navigate = useNavigate();
  const userPrefs = useAppSelector((state) => state.userPreferences.value);
  const extraction = useAppSelector((state) => state.download.extraction);
  const lastPacket = useAppSelector((state) => state.download.lastPacket);

  const { sourceName } = useActiveDownloadInfo(activeGame);

  const formatSpeed = (bytesPerSecond: number) => {
    if (userPrefs?.showDownloadSpeedInMegabits) {
      return `${formatBytesToMbps(bytesPerSecond)} Mb/s`;
    }
    return `${formatBytes(bytesPerSecond)}/s`;
  };

  const isExtracting = Boolean(
    extraction && extraction.visibleId === activeGame?.id
  );
  const extractionProgress =
    isExtracting && extraction ? Math.round(extraction.progress * 100) : 0;
  const isPaused = activeGame?.download?.status === "paused";

  const statusText = useMemo(() => {
    if (isExtracting)
      return t("download_complete", { defaultValue: "Download concluído" });
    if (isPaused) return t("paused", { defaultValue: "Pausado" });
    if (lastPacket && lastPacket.gameId === activeGame?.id) {
      if (lastPacket.isDownloadingMetadata) {
        return t("downloading_metadata", {
          defaultValue: "Baixando metadados...",
        });
      }
      if (lastPacket.isCheckingFiles) {
        return t("checking_files", { defaultValue: "Verificando arquivos..." });
      }
      if (lastPacket.isReconnecting) {
        return t("reconnecting", { defaultValue: "Reconectando..." });
      }
    }
    return t("downloading", { defaultValue: "Baixando..." });
  }, [isExtracting, isPaused, lastPacket, activeGame?.id, t]);

  const currentProgress = useMemo(() => {
    if (!activeGame?.download) return 0;
    if (lastPacket?.gameId === activeGame.id) return lastPacket.progress;
    return activeGame.download.progress;
  }, [activeGame, lastPacket]);

  const eta = useMemo(() => {
    if (!lastPacket || isExtracting || isPaused) return null;
    const timeRemaining = lastPacket.timeRemaining;
    if (!timeRemaining || timeRemaining <= 0) return null;
    return formatDistance(
      addMilliseconds(new Date(), timeRemaining),
      new Date(),
      { includeSeconds: true }
    );
  }, [lastPacket, isExtracting, isPaused, formatDistance]);

  const downloadedBytesFormatted = useMemo(() => {
    if (!activeGame?.download) return "";
    const downloaded =
      lastPacket?.gameId === activeGame.id
        ? lastPacket.download.bytesDownloaded
        : activeGame.download.bytesDownloaded;
    const total = activeGame.download.fileSize ?? 0;
    return `${formatBytes(downloaded)} / ${formatBytes(total)}`;
  }, [activeGame, lastPacket]);

  const backdropUrl = useMemo(() => {
    if (!activeGame) return "";
    if (activeGame.libraryHeroImageUrl) return activeGame.libraryHeroImageUrl;
    if (activeGame.shop === "steam" && activeGame.objectId) {
      return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${activeGame.objectId}/header.jpg`;
    }
    return activeGame.iconUrl || "";
  }, [activeGame]);

  return (
    <div
      className={`downloads-hero ${activeGame ? "downloads-hero--active" : "downloads-hero--idle"}`}
    >
      {backdropUrl && (
        <div
          className="downloads-hero__backdrop"
          style={{ backgroundImage: `url("${backdropUrl}")` }}
        />
      )}
      <div className="downloads-hero__overlay" />

      <div className="downloads-hero__content">
        <div className="downloads-hero__left">
          {activeGame ? (
            <div className="downloads-hero__game-info">
              {activeGame.logoImageUrl ? (
                <img
                  src={activeGame.logoImageUrl}
                  alt={activeGame.title}
                  className="downloads-hero__logo"
                />
              ) : (
                <h1 className="downloads-hero__title">{activeGame.title}</h1>
              )}
            </div>
          ) : (
            <div className="downloads-hero__idle-title">
              <span>
                {t("no_downloads_in_progress", {
                  defaultValue: "Nenhum download em andamento",
                })}
              </span>
            </div>
          )}
        </div>

        <div className="downloads-hero__right">
          <DownloadsHeroMetrics
            sourceName={sourceName}
            currentNetworkSpeed={currentNetworkSpeed}
            peakSpeed={peakSpeed}
            currentDiskSpeed={currentDiskSpeed}
            formatSpeed={formatSpeed}
            onOpenSettings={() => navigate("/settings")}
          />

          {activeGame && (
            <div className="downloads-hero__visual-row">
              <DownloadsSpeedChart
                networkHistory={networkHistory}
                diskHistory={diskHistory}
                maxSpeed={peakSpeed}
              />
              <DownloadsHeroProgress
                activeGame={activeGame}
                statusText={statusText}
                downloadedBytesFormatted={downloadedBytesFormatted}
                currentProgress={currentProgress}
                isExtracting={isExtracting}
                extractionProgress={extractionProgress}
                eta={eta}
                isPaused={isPaused}
                onPause={onPause}
                onResume={onResume}
                onCancel={onCancel}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
