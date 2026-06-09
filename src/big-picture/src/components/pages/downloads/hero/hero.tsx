import { PauseIcon, PlayIcon } from "@phosphor-icons/react";
import cn from "classnames";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { BIG_PICTURE_SIDEBAR_ITEM_IDS } from "../../../../layout";
import {
  getContrastTextColor,
  getItemFocusTarget,
  getOptionalItemFocusTarget,
} from "../../../../helpers";
import type { FocusOverrides } from "../../../../services";
import type { FocusItemActions } from "../../../../types";
import {
  AnimatedHeroImage,
  FocusItem,
  HorizontalFocusGroup,
  Typography,
} from "../../../common";
import {
  DOWNLOADS_HERO_ACTIONS_REGION_ID,
  DOWNLOADS_HERO_CANCEL_BUTTON_ID,
  DOWNLOADS_HERO_PAUSE_RESUME_BUTTON_ID,
} from "../navigation";
import type {
  DownloadsHeroSnapshot,
  DownloadsHeroSnapshotLayer,
} from "./use-downloads-hero-visual-state";

import "./hero.scss";

interface DownloadsHeroProps {
  snapshot: DownloadsHeroSnapshot | null;
  backgroundLayers: DownloadsHeroSnapshotLayer[];
  getLayerEventHandlers: (layer: DownloadsHeroSnapshotLayer) => {
    onLoad: () => void;
    onError: () => void;
    onTransitionEnd: () => void;
  };
  navigationOrder?: number;
  isInteractive?: boolean;
  onPauseOrResume: () => void;
  onCancel: () => void;
  onOpenDetails: () => void;
  isMoveGrabbed?: boolean;
  isDragSource?: boolean;
  isDragging?: boolean;
  isDropActive?: boolean;
  isDropDisabled?: boolean;
  isMoveModeActive?: boolean;
  nextListFocusId?: string;
}

interface HeroActionButtonProps {
  focusId: string;
  navigationOverrides: FocusOverrides;
  focusActions?: FocusItemActions;
  variant: "primary" | "secondary" | "danger";
  icon?: ReactNode;
  label: string;
  disabled?: boolean;
  style?: CSSProperties;
  onClick?: () => void;
}

function HeroActionButton({
  focusId,
  navigationOverrides,
  focusActions,
  variant,
  icon,
  label,
  disabled = false,
  style,
  onClick,
}: Readonly<HeroActionButtonProps>) {
  return (
    <FocusItem
      id={focusId}
      actions={focusActions}
      navigationOverrides={navigationOverrides}
      asChild
    >
      <button
        type="button"
        className={cn(
          "button",
          `button--${variant}`,
          "button--large",
          disabled && "button--disabled"
        )}
        onClick={() => {
          if (disabled) return;
          onClick?.();
        }}
        aria-disabled={disabled}
        style={style}
      >
        {icon ? (
          <div className="button__icon-container--left button__icon-container">
            {icon}
          </div>
        ) : null}
        <p className="button__text">{label}</p>
      </button>
    </FocusItem>
  );
}

export function DownloadsHero({
  snapshot,
  backgroundLayers,
  getLayerEventHandlers,
  navigationOrder = 0,
  isInteractive = true,
  onPauseOrResume,
  onCancel,
  onOpenDetails,
  isMoveGrabbed = false,
  isDragSource = false,
  isDragging = false,
  isDropActive = false,
  isDropDisabled = false,
  isMoveModeActive = false,
  nextListFocusId,
}: Readonly<DownloadsHeroProps>) {
  const [shouldShowLogoFallback, setShouldShowLogoFallback] = useState(false);

  useEffect(() => {
    setShouldShowLogoFallback(false);
  }, [snapshot?.id, snapshot?.logoImageUrl]);

  const pauseResumeNavigationOverrides = useMemo<FocusOverrides>(
    () => ({
      left: getItemFocusTarget(BIG_PICTURE_SIDEBAR_ITEM_IDS.downloads),
      right: {
        type: "item",
        itemId: DOWNLOADS_HERO_CANCEL_BUTTON_ID,
      },
      down: getOptionalItemFocusTarget(nextListFocusId),
    }),
    [nextListFocusId]
  );

  const cancelNavigationOverrides = useMemo<FocusOverrides>(
    () => ({
      left: {
        type: "item",
        itemId: DOWNLOADS_HERO_PAUSE_RESUME_BUTTON_ID,
      },
      right: {
        type: "block",
      },
      down: getOptionalItemFocusTarget(nextListFocusId),
    }),
    [nextListFocusId]
  );

  const pauseResumeIcon = snapshot?.pauseOrResumeLabel
    ?.toLowerCase()
    .includes("resume") ? (
    <PlayIcon size={24} weight="fill" />
  ) : (
    <PauseIcon size={24} weight="fill" />
  );
  const pauseResumeButtonStyle = useMemo(() => {
    if (!snapshot?.accentColor) return undefined;

    return {
      "--button-custom-color": snapshot.accentColor,
      "--button-custom-hover-color": `color-mix(in srgb, ${snapshot.accentColor} 80%, white)`,
      "--button-custom-text-color": getContrastTextColor(snapshot.accentColor),
    } as CSSProperties;
  }, [snapshot?.accentColor]);
  const actionsDisabled = isMoveModeActive || !isInteractive;
  const blockedHeroActions = useMemo<FocusItemActions>(
    () => ({
      primary: "off",
      secondary: "off",
    }),
    []
  );
  const pauseHeroActions = useMemo<FocusItemActions>(
    () => ({
      primary: "auto",
      secondary: "off",
    }),
    []
  );
  const cancelHeroActions = useMemo<FocusItemActions>(
    () => ({
      primary: "auto",
      secondary: "off",
    }),
    []
  );

  return (
    <section
      className="downloads-hero"
      aria-label={snapshot?.title ?? "Downloads hero"}
    >
      {backgroundLayers.map((layer) => {
        const layerHandlers = getLayerEventHandlers(layer);

        return (
          <div
            key={layer.key}
            className={cn(
              `downloads-hero__bg-layer downloads-hero__bg-layer--${layer.role}`,
              layer.isVisible && "downloads-hero__bg-layer--visible"
            )}
            onTransitionEnd={layerHandlers.onTransitionEnd}
          >
            <AnimatedHeroImage
              className="downloads-hero__bg"
              imageUrl={layer.snapshot.backgroundImageUrl ?? ""}
              onLoad={layerHandlers.onLoad}
              onError={layerHandlers.onError}
            />
          </div>
        );
      })}

      <div className="downloads-hero__overlay" />

      <div className="downloads-hero__content" data-download-drop-target="hero">
        {snapshot ? (
          <div className="downloads-hero__active">
            <button
              type="button"
              className={cn(
                "downloads-hero__main",
                isDragSource && "downloads-hero__main--drag-source",
                isDragging && "downloads-hero__main--dragging",
                isDropActive && "downloads-hero__main--drop-active",
                isDropDisabled && "downloads-hero__main--drop-disabled",
                isMoveGrabbed && "downloads-hero__main--move-grabbed"
              )}
              onClick={() => {
                if (!isInteractive) return;
                onOpenDetails();
              }}
              data-download-drag-source={
                isDragSource && isInteractive ? "true" : undefined
              }
              data-drag-placement={
                isDragSource && isInteractive ? "hero" : undefined
              }
              data-game-id={snapshot.id}
              tabIndex={-1}
              aria-disabled={!isInteractive}
            >
              <div className="downloads-hero__logo">
                {snapshot.logoImageUrl && !shouldShowLogoFallback ? (
                  <img
                    src={snapshot.logoImageUrl}
                    alt={snapshot.title}
                    className="downloads-hero__logo-image"
                    onError={() => setShouldShowLogoFallback(true)}
                  />
                ) : (
                  <span className="downloads-hero__logo-fallback">
                    {snapshot.title}
                  </span>
                )}
              </div>
            </button>

            <HorizontalFocusGroup
              className="downloads-hero__actions"
              regionId={DOWNLOADS_HERO_ACTIONS_REGION_ID}
              navigationOrder={navigationOrder}
            >
              <HeroActionButton
                focusId={DOWNLOADS_HERO_PAUSE_RESUME_BUTTON_ID}
                navigationOverrides={pauseResumeNavigationOverrides}
                focusActions={
                  actionsDisabled ? blockedHeroActions : pauseHeroActions
                }
                variant="primary"
                icon={pauseResumeIcon}
                label={snapshot.pauseOrResumeLabel}
                disabled={actionsDisabled || !snapshot.canPauseOrResume}
                style={pauseResumeButtonStyle}
                onClick={onPauseOrResume}
              />

              <HeroActionButton
                focusId={DOWNLOADS_HERO_CANCEL_BUTTON_ID}
                navigationOverrides={cancelNavigationOverrides}
                focusActions={
                  actionsDisabled ? blockedHeroActions : cancelHeroActions
                }
                variant="danger"
                label="Cancel"
                disabled={actionsDisabled}
                onClick={onCancel}
              />
            </HorizontalFocusGroup>
          </div>
        ) : (
          <div
            className={cn(
              "downloads-hero__empty",
              isDropActive && "downloads-hero__empty--drop-active"
            )}
          >
            <div className="downloads-hero__empty-copy">
              <Typography variant="h2">Drop here to start now</Typography>
              <Typography className="downloads-page__empty-copy">
                Drag a paused or queued download here to make it active.
              </Typography>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
