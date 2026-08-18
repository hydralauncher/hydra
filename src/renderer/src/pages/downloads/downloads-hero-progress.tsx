import { useTranslation } from "react-i18next";
import type { LibraryGame } from "@types";
import { DownloadIcon } from "@primer/octicons-react";
import { Pause, Play, X } from "lucide-react";

interface DownloadsHeroProgressProps {
  activeGame: LibraryGame;
  statusText: string;
  downloadedBytesFormatted: string;
  currentProgress: number;
  isExtracting: boolean;
  extractionProgress: number;
  eta: string | null;
  isPaused: boolean;
  onPause: (game: LibraryGame) => void;
  onResume: (game: LibraryGame) => void;
  onCancel: (game: LibraryGame) => void;
}

export function DownloadsHeroProgress({
  activeGame,
  statusText,
  downloadedBytesFormatted,
  currentProgress,
  isExtracting,
  extractionProgress,
  eta,
  isPaused,
  onPause,
  onResume,
  onCancel,
}: Readonly<DownloadsHeroProgressProps>) {
  const { t } = useTranslation("downloads");

  return (
    <div className="downloads-hero__bars-container">
      <div className="downloads-hero__status-line">
        <span className="downloads-hero__status-text">{statusText}</span>
        <span className="downloads-hero__status-size">
          {downloadedBytesFormatted} <DownloadIcon size={12} />
        </span>
      </div>

      <div className="downloads-hero__progress-track downloads-hero__progress-track--blue">
        <div
          className="downloads-hero__progress-fill downloads-hero__progress-fill--blue"
          style={{ width: `${currentProgress * 100}%` }}
        />
      </div>

      {isExtracting && (
        <>
          <div className="downloads-hero__status-line downloads-hero__status-line--sub">
            <span className="downloads-hero__status-text">
              {t("installing_files", { defaultValue: "Instalando arquivos" })}
            </span>
            <span className="downloads-hero__status-percent">
              {extractionProgress}%
            </span>
          </div>
          <div className="downloads-hero__progress-track downloads-hero__progress-track--green">
            <div
              className="downloads-hero__progress-fill downloads-hero__progress-fill--green"
              style={{ width: `${extractionProgress}%` }}
            />
          </div>
        </>
      )}

      <div className="downloads-hero__footer-line">
        <span className="downloads-hero__eta">
          {eta
            ? `${t("time_remaining", {
                defaultValue: "Tempo restante estimado",
              })}: ${eta}`
            : ""}
        </span>
        <div className="downloads-hero__actions">
          <button
            type="button"
            className="downloads-hero__ctrl-btn"
            onClick={() =>
              isPaused ? onResume(activeGame) : onPause(activeGame)
            }
            title={isPaused ? t("resume") : t("pause")}
          >
            {isPaused ? <Play size={14} /> : <Pause size={14} />}
          </button>
          <button
            type="button"
            className="downloads-hero__ctrl-btn downloads-hero__ctrl-btn--cancel"
            onClick={() => onCancel(activeGame)}
            title={t("cancel")}
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
