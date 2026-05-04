import type { LibraryGame } from "@types";
import { GearIcon, PauseIcon, PlayIcon } from "@phosphor-icons/react";
import cn from "classnames";
import { useEffect, useMemo, useState } from "react";
import { BIG_PICTURE_SIDEBAR_ITEM_IDS } from "../../../../layout";
import { useDominantColor } from "../../../../hooks";
import { getItemFocusTarget } from "../../../../helpers";
import type { FocusItemActions } from "../../../../types";
import type { FocusOverrides } from "../../../../services";
import {
  AnimatedHeroImage,
  Button,
  FocusItem,
  HorizontalFocusGroup,
  Typography,
} from "../../../common";
import { useHeroBackgroundLayers } from "../../library/hero/use-hero-background-layers";
import {
  DOWNLOADS_HERO_ACTIONS_REGION_ID,
  DOWNLOADS_HERO_OPTIONS_BUTTON_ID,
  DOWNLOADS_HERO_PAUSE_RESUME_BUTTON_ID,
} from "../navigation";

import "./hero.scss";

interface DownloadsHeroDownload {
  id: string;
  title: string;
  href: string;
  game: LibraryGame;
}

interface DownloadsHeroProps {
  download: DownloadsHeroDownload | null;
  canPauseOrResume: boolean;
  pauseOrResumeLabel: string;
  onPauseOrResume: () => void;
  onOpenOptions?: () => void;
  onOpenDetails: () => void;
  isMoveGrabbed?: boolean;
  isDragSource?: boolean;
  isDragging?: boolean;
  isDropActive?: boolean;
  isDropDisabled?: boolean;
  focusId?: string;
  focusActions?: FocusItemActions;
}

export function DownloadsHero({
  download,
  canPauseOrResume,
  pauseOrResumeLabel,
  onPauseOrResume,
  onOpenOptions,
  onOpenDetails,
  isMoveGrabbed = false,
  isDragSource = false,
  isDragging = false,
  isDropActive = false,
  isDropDisabled = false,
  focusId,
  focusActions,
}: Readonly<DownloadsHeroProps>) {
  const [shouldShowLogoFallback, setShouldShowLogoFallback] = useState(false);
  const dominantColor = useDominantColor(
    download?.game.libraryHeroImageUrl ?? null
  );
  const { backgroundLayers, getLayerEventHandlers } = useHeroBackgroundLayers(
    download?.game.libraryHeroImageUrl
  );

  useEffect(() => {
    setShouldShowLogoFallback(false);
  }, [download?.game.logoImageUrl]);

  const pauseResumeNavigationOverrides = useMemo<FocusOverrides>(
    () => ({
      left: getItemFocusTarget(BIG_PICTURE_SIDEBAR_ITEM_IDS.downloads),
      right: {
        type: "item",
        itemId: DOWNLOADS_HERO_OPTIONS_BUTTON_ID,
      },
    }),
    []
  );

  const optionsNavigationOverrides = useMemo<FocusOverrides>(
    () => ({
      left: {
        type: "item",
        itemId: DOWNLOADS_HERO_PAUSE_RESUME_BUTTON_ID,
      },
      right: {
        type: "block",
      },
    }),
    []
  );

  const pauseResumeIcon = pauseOrResumeLabel.toLowerCase().includes("resume") ? (
    <PlayIcon size={24} weight="fill" />
  ) : (
    <PauseIcon size={24} weight="fill" />
  );

  return (
    <section className="downloads-hero" aria-label={download?.title ?? "Downloads hero"}>
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
              imageUrl={layer.imageUrl}
              onLoad={layerHandlers.onLoad}
              onError={layerHandlers.onError}
            />
          </div>
        );
      })}

      <div className="downloads-hero__overlay" />

      <div className="downloads-hero__content" data-download-drop-target="hero">
        {download ? (
          <div className="downloads-hero__active">
            <FocusItem id={focusId} actions={focusActions} asChild>
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
                onClick={onOpenDetails}
                data-download-drag-source={isDragSource ? "true" : undefined}
                data-drag-placement={isDragSource ? "hero" : undefined}
                data-game-id={download.id}
              >
                <div className="downloads-hero__logo">
                  {download.game.logoImageUrl && !shouldShowLogoFallback ? (
                    <img
                      src={download.game.logoImageUrl}
                      alt={download.title}
                      className="downloads-hero__logo-image"
                      onError={() => setShouldShowLogoFallback(true)}
                    />
                  ) : (
                    <span className="downloads-hero__logo-fallback">
                      {download.title}
                    </span>
                  )}
                </div>
              </button>
            </FocusItem>

            <HorizontalFocusGroup
              className="downloads-hero__actions"
              regionId={DOWNLOADS_HERO_ACTIONS_REGION_ID}
            >
              <Button
                variant="primary"
                size="large"
                color={dominantColor ?? undefined}
                icon={pauseResumeIcon}
                focusId={DOWNLOADS_HERO_PAUSE_RESUME_BUTTON_ID}
                focusNavigationOverrides={pauseResumeNavigationOverrides}
                disabled={!canPauseOrResume}
                onClick={onPauseOrResume}
              >
                {pauseOrResumeLabel}
              </Button>

              <Button
                variant="secondary"
                size="large"
                icon={<GearIcon size={24} />}
                focusId={DOWNLOADS_HERO_OPTIONS_BUTTON_ID}
                focusNavigationOverrides={optionsNavigationOverrides}
                onClick={() => {
                  onOpenOptions?.();
                }}
              >
                Options
              </Button>
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
