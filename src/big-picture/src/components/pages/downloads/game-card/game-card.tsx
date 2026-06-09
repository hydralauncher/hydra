import {
  DotsThreeVerticalIcon,
  PauseIcon,
  PlayIcon,
} from "@phosphor-icons/react";
import cn from "classnames";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { FocusItemActions } from "../../../../types";
import type { FocusOverrides } from "../../../../services";
import { Button, FocusItem, HorizontalFocusGroup } from "../../../common";

import "./game-card.scss";

type DownloadsGameCardVariant = "queue" | "paused" | "completed";

interface DownloadsGameCardProps {
  gameId: string;
  title: string;
  coverImageUrl: string | null;
  logoImageUrl?: string | null;
  metaLabel?: string | null;
  secondaryLabel: string;
  progress?: number | null;
  progressLabel?: string | null;
  rightStatusLabel?: string | null;
  variant: DownloadsGameCardVariant;
  onOpen: () => void;
  onPrimaryAction?: () => void;
  primaryActionLabel?: string;
  onOpenOptions?: React.MouseEventHandler<HTMLButtonElement>;
  optionsLabel?: string;
  primaryActionDisabled?: boolean;
  optionsDisabled?: boolean;
  primaryActionFocusId?: string;
  optionsFocusId?: string;
  dragPlacement?: "queue" | "paused";
  dropPlacement?: "queue" | "paused";
  dropIndex?: number;
  navigationOrder?: number;
  isDragging?: boolean;
  isMoveGrabbed?: boolean;
  focusId?: string;
  focusActions?: FocusItemActions;
  navigationOverrides?: FocusOverrides;
}

function clampProgress(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function DownloadsGameCard({
  gameId,
  title,
  coverImageUrl,
  logoImageUrl,
  metaLabel,
  secondaryLabel,
  progress,
  progressLabel,
  rightStatusLabel,
  variant,
  onOpen,
  onPrimaryAction,
  primaryActionLabel,
  onOpenOptions,
  optionsLabel = "Options",
  primaryActionDisabled = false,
  optionsDisabled = false,
  primaryActionFocusId,
  optionsFocusId,
  dragPlacement,
  dropPlacement,
  dropIndex,
  navigationOrder,
  isDragging = false,
  isMoveGrabbed = false,
  focusId,
  focusActions,
  navigationOverrides,
}: Readonly<DownloadsGameCardProps>) {
  const normalizedProgress = clampProgress(progress);
  const showsProgress =
    (variant === "queue" || variant === "paused") && progressLabel != null;
  const showsProgressMeta = showsProgress && metaLabel != null;
  const showsRightMeta = variant === "completed" && metaLabel != null;
  const primaryActionIcon =
    variant === "paused" ? (
      <PlayIcon size={22} weight="fill" />
    ) : (
      <PauseIcon size={22} weight="fill" />
    );
  const stopCardOpen = (event: ReactMouseEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  return (
    <HorizontalFocusGroup
      className="downloads-game-card"
      navigationOrder={navigationOrder}
    >
      <FocusItem
        id={focusId}
        actions={focusActions}
        navigationOverrides={navigationOverrides}
        asChild
      >
        <button
          type="button"
          className={cn(
            "downloads-game-card__main",
            dragPlacement && "downloads-page__drag-source",
            isDragging && "downloads-page__drag-source--dragging",
            isMoveGrabbed && "downloads-page__move-grabbed"
          )}
          onClick={onOpen}
          data-download-drag-source={dragPlacement ? "true" : undefined}
          data-drag-placement={dragPlacement}
          data-game-id={dragPlacement ? gameId : undefined}
          data-download-drop-target={dropPlacement}
          data-download-drop-role={dropPlacement ? "card" : undefined}
          data-drop-placement={dropPlacement}
          data-drop-index={dropPlacement != null ? dropIndex : undefined}
        >
          <div className="downloads-game-card__cover">
            {coverImageUrl ? (
              <img
                className="downloads-game-card__cover-image"
                src={coverImageUrl}
                alt={title}
                draggable={false}
              />
            ) : (
              <div
                className="downloads-game-card__cover-placeholder"
                aria-hidden="true"
              />
            )}

            {logoImageUrl ? (
              <div className="downloads-game-card__logo" aria-hidden="true">
                <img
                  className="downloads-game-card__logo-image"
                  src={logoImageUrl}
                  alt=""
                  draggable={false}
                />
              </div>
            ) : null}
          </div>

          <div className="downloads-game-card__body">
            <div className="downloads-game-card__copy">
              <h3 className="downloads-game-card__title">{title}</h3>
              <p className="downloads-game-card__secondary">{secondaryLabel}</p>
            </div>

            <div className="downloads-game-card__side">
              {showsProgress ? (
                <div className="downloads-game-card__progress">
                  <div className="downloads-game-card__progress-header">
                    {showsProgressMeta ? (
                      <span className="downloads-game-card__progress-meta">
                        {metaLabel}
                      </span>
                    ) : null}
                    <span className="downloads-game-card__progress-label">
                      {progressLabel}
                    </span>
                  </div>
                  <div className="downloads-game-card__progress-track">
                    <div
                      className="downloads-game-card__progress-fill"
                      style={{ width: `${normalizedProgress * 100}%` }}
                    />
                  </div>
                </div>
              ) : null}

              {rightStatusLabel || showsRightMeta ? (
                <div className="downloads-game-card__status-stack">
                  {rightStatusLabel ? (
                    <div className="downloads-game-card__status">
                      {rightStatusLabel}
                    </div>
                  ) : null}
                  {showsRightMeta ? (
                    <div className="downloads-game-card__status-meta">
                      {metaLabel}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="downloads-game-card__actions">
                {primaryActionLabel && onPrimaryAction ? (
                  <Button
                    focusable={false}
                    variant="secondary"
                    size="icon"
                    className="downloads-game-card__action-button downloads-game-card__action-button--icon-only"
                    icon={primaryActionIcon}
                    aria-label={primaryActionLabel}
                    disabled={primaryActionDisabled}
                    onClick={(event) => {
                      stopCardOpen(event);
                      onPrimaryAction();
                    }}
                    onMouseDown={stopCardOpen}
                    focusId={primaryActionFocusId}
                  >
                    {null}
                  </Button>
                ) : null}

                <Button
                  focusable={false}
                  variant="secondary"
                  size="icon"
                  className="downloads-game-card__action-button downloads-game-card__action-button--icon-only"
                  disabled={optionsDisabled}
                  icon={<DotsThreeVerticalIcon size={24} weight="bold" />}
                  aria-label={optionsLabel}
                  onClick={(event) => {
                    stopCardOpen(event);
                    onOpenOptions?.(event);
                  }}
                  onMouseDown={stopCardOpen}
                  focusId={optionsFocusId}
                >
                  {null}
                </Button>
              </div>
            </div>
          </div>
        </button>
      </FocusItem>
    </HorizontalFocusGroup>
  );
}
