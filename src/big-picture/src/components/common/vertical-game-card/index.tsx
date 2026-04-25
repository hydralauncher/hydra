import "./styles.scss";

import { SparkleIcon, TrophyIcon } from "@phosphor-icons/react";
import cn from "classnames";
import type { CSSProperties, ReactNode } from "react";

export interface VerticalGameCardProps {
  coverImageUrl?: string | null;
  gameTitle: string;
  subtitle: string;
  progressLabel?: string;
  progressValue?: number;
  progressColor?: string;
  action?: ReactNode;
  forceHovered?: boolean;
  className?: string;
  onClick?: () => void;
  onCoverImageError?: () => void;
}

const DEFAULT_PROGRESS_COLOR = "var(--alert)";

function clampProgress(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function VerticalGameCard({
  coverImageUrl,
  gameTitle,
  subtitle,
  progressLabel,
  progressValue,
  progressColor = DEFAULT_PROGRESS_COLOR,
  action,
  forceHovered = false,
  className,
  onClick,
  onCoverImageError,
}: Readonly<VerticalGameCardProps>) {
  const hasProgress =
    progressLabel != null &&
    progressValue != null &&
    !Number.isNaN(progressValue);
  const normalizedProgress = hasProgress ? clampProgress(progressValue) : 0;
  const isCompleted = hasProgress && normalizedProgress === 1;

  const customProperties = {
    "--vertical-game-card-progress-color": progressColor,
    "--vertical-game-card-progress-value": normalizedProgress,
  } as CSSProperties;
  const ProgressIcon = isCompleted ? SparkleIcon : TrophyIcon;

  return (
    <article
      className={cn("vertical-game-card", className, {
        "vertical-game-card--completed": isCompleted,
        "vertical-game-card--force-hovered": forceHovered,
      })}
      style={customProperties}
      onClick={onClick}
    >
      <div className="vertical-game-card__cover">
        {coverImageUrl ? (
          <img
            src={coverImageUrl}
            alt={gameTitle}
            draggable={false}
            onError={onCoverImageError}
          />
        ) : (
          <div
            className="vertical-game-card__cover-placeholder"
            aria-hidden="true"
          />
        )}
      </div>

      <div className="vertical-game-card__body">
        <div className="vertical-game-card__info">
          <div className="vertical-game-card__text">
            <h3 className="vertical-game-card__title">{gameTitle}</h3>
            <p className="vertical-game-card__subtitle">{subtitle}</p>
          </div>

          <div
            className={cn("vertical-game-card__progress", {
              "vertical-game-card__progress--placeholder": !hasProgress,
            })}
            aria-hidden={!hasProgress || undefined}
          >
            <div className="vertical-game-card__progress-label">
              <ProgressIcon size={16} weight="fill" />
              <span>{progressLabel ?? "0/0"}</span>
            </div>

            <div className="vertical-game-card__progress-track" />
          </div>
        </div>

        {action && <div className="vertical-game-card__action">{action}</div>}
      </div>
    </article>
  );
}
