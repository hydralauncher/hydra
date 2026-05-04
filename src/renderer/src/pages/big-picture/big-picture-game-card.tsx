import type { LibraryGame } from "@types";
import { useTranslation } from "react-i18next";
import { DownloadIcon } from "@primer/octicons-react";
import "./big-picture-game-card.scss";

interface BigPictureGameCardProps {
  game: LibraryGame;
  onClick: () => void;
  isRunning?: boolean;
  isInstalled?: boolean;
  isAvailable?: boolean;
  downloadProgress?: { raw: number; formatted: string } | null;
  index?: number;
}

export function BigPictureGameCard({
  game,
  onClick,
  isRunning,
  isInstalled,
  isAvailable,
  downloadProgress,
  index = 0,
}: BigPictureGameCardProps) {
  const { t } = useTranslation("big_picture");

  const isNotInstalled = !isInstalled && !downloadProgress;

  const getStatus = () => {
    if (isRunning)
      return { label: t("game_running"), type: "running" as const };
    if (downloadProgress)
      return {
        label: `${t("downloading")} ${downloadProgress.formatted}`,
        type: "downloading" as const,
      };
    if (game.download?.status === "paused")
      return { label: t("paused"), type: "default" as const };
    if (game.download?.queued)
      return { label: t("queued"), type: "default" as const };
    if (game.executablePath)
      return { label: t("installed"), type: "default" as const };
    if (isAvailable)
      return { label: t("available"), type: "available" as const };
    return { label: t("unavailable"), type: "unavailable" as const };
  };

  const status = getStatus();

  // Stagger animation delay (cap at 800ms total)
  const staggerDelay = Math.min(index * 40, 800);

  const cardClass = [
    "bp-game-card",
    isRunning && "bp-game-card--running",
    isNotInstalled && isAvailable && "bp-game-card--not-installed",
    isNotInstalled && !isAvailable && "bp-game-card--unavailable",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={cardClass}
      data-bp-focusable
      onClick={onClick}
      style={{ "--stagger-delay": `${staggerDelay}ms` } as React.CSSProperties}
    >
      <div className="bp-game-card__image-wrapper">
        {game.coverImageUrl ? (
          <img
            src={game.coverImageUrl}
            alt={game.title}
            className="bp-game-card__image"
            loading="lazy"
          />
        ) : (
          <div className="bp-game-card__placeholder" />
        )}

        {isNotInstalled && (
          <div
            className={`bp-game-card__download-badge ${!isAvailable ? "bp-game-card__download-badge--unavailable" : ""}`}
          >
            <DownloadIcon size={18} />
            {!isAvailable && (
              <span className="bp-game-card__download-badge-slash" />
            )}
          </div>
        )}

        {downloadProgress && (
          <div className="bp-game-card__progress-bar">
            <div
              className="bp-game-card__progress-fill"
              style={{ width: `${downloadProgress.raw * 100}%` }}
            />
          </div>
        )}
      </div>

      <div className="bp-game-card__info">
        <span className="bp-game-card__title">{game.title}</span>
        <span
          className={`bp-game-card__status bp-game-card__status--${status.type}`}
        >
          {(status.type === "running" || status.type === "downloading") && (
            <span
              className={`bp-game-card__status-dot bp-game-card__status-dot--${status.type}`}
            />
          )}
          {status.label}
        </span>
      </div>
    </button>
  );
}
