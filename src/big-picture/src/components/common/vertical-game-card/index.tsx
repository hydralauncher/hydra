import "./styles.scss";

import { PlayIcon, TrophyIcon } from "@phosphor-icons/react";
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
  hoverIndicator?: ReactNode;
  forceHovered?: boolean;
  className?: string;
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
  hoverIndicator = <PlayIcon size={24} weight="fill" />,
  forceHovered = false,
  className,
}: Readonly<VerticalGameCardProps>) {
  const hasProgress =
    progressLabel != null &&
    progressValue != null &&
    !Number.isNaN(progressValue);
  const normalizedProgress = hasProgress ? clampProgress(progressValue) : 0;

  const customProperties = {
    "--vertical-game-card-progress-color": progressColor,
    "--vertical-game-card-progress-value": normalizedProgress,
  } as CSSProperties;

  return (
    <article
      className={cn("vertical-game-card", className, {
        "vertical-game-card--force-hovered": forceHovered,
      })}
      style={customProperties}
    >
      <div className="vertical-game-card__cover">
        {coverImageUrl ? (
          <img src={coverImageUrl} alt={gameTitle} draggable={false} />
        ) : (
          <div
            className="vertical-game-card__cover-placeholder"
            aria-hidden="true"
          />
        )}

        <div className="vertical-game-card__cover-overlay" aria-hidden="true" />

        <div className="vertical-game-card__hover-indicator" aria-hidden="true">
          {hoverIndicator}
        </div>
      </div>

      <div className="vertical-game-card__body">
        <div className="vertical-game-card__info">
          <div className="vertical-game-card__text">
            <h3 className="vertical-game-card__title">{gameTitle}</h3>
            <p className="vertical-game-card__subtitle">{subtitle}</p>
          </div>

          {hasProgress && (
            <div className="vertical-game-card__progress">
              <div className="vertical-game-card__progress-label">
                <TrophyIcon size={16} />
                <span>{progressLabel}</span>
              </div>

              <div className="vertical-game-card__progress-track" />
            </div>
          )}
        </div>

        {action && <div className="vertical-game-card__action">{action}</div>}
      </div>
    </article>
  );
}
