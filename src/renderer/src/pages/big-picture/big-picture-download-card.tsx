import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useDownload } from "@renderer/hooks";
import type { LibraryGame } from "@types";
import "./big-picture-download-card.scss";

interface BigPictureDownloadCardProps {
  game: LibraryGame;
  progress: number;
  progressFormatted: string;
  speed: string;
  eta: string;
  status: "active" | "paused" | "queued" | "completed";
}

export function BigPictureDownloadCard({
  game,
  progress,
  progressFormatted,
  speed,
  eta,
  status,
}: BigPictureDownloadCardProps) {
  const { t } = useTranslation("big_picture");
  const { pauseDownload, resumeDownload, cancelDownload } = useDownload();

  const handlePause = useCallback(() => {
    pauseDownload(game.shop, game.objectId);
  }, [game, pauseDownload]);

  const handleResume = useCallback(() => {
    resumeDownload(game.shop, game.objectId);
  }, [game, resumeDownload]);

  const handleCancel = useCallback(() => {
    cancelDownload(game.shop, game.objectId);
  }, [game, cancelDownload]);

  return (
    <div className="bp-download-card" data-bp-focusable>
      <div className="bp-download-card__cover">
        {game.coverImageUrl ? (
          <img src={game.coverImageUrl} alt="" loading="lazy" />
        ) : (
          <div className="bp-download-card__cover-placeholder" />
        )}
      </div>

      <div className="bp-download-card__info">
        <span className="bp-download-card__title">{game.title}</span>

        <div className="bp-download-card__progress-bar">
          <div
            className={`bp-download-card__progress-fill ${
              status === "active"
                ? "bp-download-card__progress-fill--active"
                : ""
            }`}
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        <div className="bp-download-card__meta">
          <span>{progressFormatted}</span>
          {speed && (
            <span>
              {t("download_speed")}: {speed}
            </span>
          )}
          {eta && (
            <span>
              {t("eta")}: {eta}
            </span>
          )}
        </div>
      </div>

      <div className="bp-download-card__actions">
        {status === "active" && (
          <button
            type="button"
            className="bp-download-card__btn"
            data-bp-focusable
            onClick={handlePause}
          >
            {t("pause_download")}
          </button>
        )}
        {status === "paused" && (
          <button
            type="button"
            className="bp-download-card__btn"
            data-bp-focusable
            onClick={handleResume}
          >
            {t("resume_download")}
          </button>
        )}
        {(status === "active" ||
          status === "paused" ||
          status === "queued") && (
          <button
            type="button"
            className="bp-download-card__btn bp-download-card__btn--danger"
            data-bp-focusable
            onClick={handleCancel}
          >
            {t("cancel_download")}
          </button>
        )}
      </div>
    </div>
  );
}
