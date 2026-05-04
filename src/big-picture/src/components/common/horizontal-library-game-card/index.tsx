import "./styles.scss";

import { SparkleIcon, TrophyIcon } from "@phosphor-icons/react";
import cn from "classnames";
import type {
  CSSProperties,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";

export interface HorizontalLibraryGameCardProps {
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
  onContextMenu?: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onCoverImageError?: () => void;
}

const DEFAULT_PROGRESS_COLOR = "var(--alert)";

function clampProgress(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function HorizontalLibraryGameCard({
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
  onContextMenu,
  onCoverImageError,
}: Readonly<HorizontalLibraryGameCardProps>) {
  const hasProgress =
    progressLabel != null &&
    progressValue != null &&
    !Number.isNaN(progressValue);
  const normalizedProgress = hasProgress ? clampProgress(progressValue) : 0;
  const isCompleted = hasProgress && normalizedProgress === 1;

  const customProperties = {
    "--horizontal-library-game-card-progress-color": progressColor,
    "--horizontal-library-game-card-progress-value": normalizedProgress,
  } as CSSProperties;
  const ProgressIcon = isCompleted ? SparkleIcon : TrophyIcon;

  const handleCardKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (onClick == null) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <div
      className={cn("horizontal-library-game-card", className, {
        "horizontal-library-game-card--completed": isCompleted,
        "horizontal-library-game-card--force-hovered": forceHovered,
      })}
      style={customProperties}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={onClick != null ? handleCardKeyDown : undefined}
      role={onClick != null ? "button" : undefined}
      tabIndex={onClick != null ? 0 : undefined}
    >
      <div className="horizontal-library-game-card__cover">
        {coverImageUrl ? (
          <img
            src={coverImageUrl}
            alt={gameTitle}
            draggable={false}
            onError={onCoverImageError}
          />
        ) : (
          <div
            className="horizontal-library-game-card__cover-placeholder"
            aria-hidden="true"
          />
        )}
      </div>

      <div className="horizontal-library-game-card__body">
        <div className="horizontal-library-game-card__info">
          <div className="horizontal-library-game-card__text">
            <h3 className="horizontal-library-game-card__title">{gameTitle}</h3>
            <p className="horizontal-library-game-card__subtitle">{subtitle}</p>
          </div>

          <div
            className={cn("horizontal-library-game-card__progress", {
              "horizontal-library-game-card__progress--placeholder":
                !hasProgress,
            })}
            aria-hidden={!hasProgress || undefined}
          >
            <div className="horizontal-library-game-card__progress-label">
              <ProgressIcon size={16} weight="fill" />
              <span>{progressLabel ?? "0/0"}</span>
            </div>

            <div className="horizontal-library-game-card__progress-track" />
          </div>
        </div>

        {action ? (
          <div className="horizontal-library-game-card__action">{action}</div>
        ) : null}
      </div>
    </div>
  );
}
