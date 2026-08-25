import {
  DownloadSimpleIcon,
  GearIcon,
  HeartIcon,
  PlayIcon,
  PlusCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import type { LibraryGame, ShopDetailsWithAssets } from "@types";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  FocusOverrides,
  FocusOverrideTarget,
} from "src/big-picture/src/services/navigation.service";
import {
  animateNavigationScrollForElement,
  resolvePreferredGameAssets,
} from "../../../../helpers";
import { useDominantColor } from "../../../../hooks";
import { useNavigationStore } from "../../../../stores";
import { BIG_PICTURE_SIDEBAR_ITEM_IDS } from "../../../../layout";
import {
  AnimatedHeroImage,
  Button,
  Divider,
  HorizontalFocusGroup,
  Typography,
} from "../../../common";
import {
  GAME_HERO_ACTIONS_REGION_ID,
  GAME_HERO_DOWNLOAD_OPTIONS_ID,
  GAME_HERO_OPEN_CLOUD_SAVE_ID,
  GAME_HERO_OPEN_SETTINGS_ID,
  GAME_HERO_PRIMARY_ACTION_ID,
  GAME_HERO_TOGGLE_FAVORITE_ID,
} from "../navigation";
import { BigPictureCloudSaveHeroButton } from "../cloud-save-v2";
import { useHeroBackgroundLayers } from "../../library/hero/use-hero-background-layers";
import cn from "classnames";

export interface HeroProps {
  shopDetails: ShopDetailsWithAssets;
  game: LibraryGame | null;
  isGameRunning: boolean;
  isFavorite: boolean;
  toggleFavorite: () => void;
  onPlay: () => void;
  onDownload: () => void;
  onAddToLibrary: () => void;
  onOpenDownloadOptions: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
  isAddingToLibrary: boolean;
  canAddToLibrary: boolean;
  downNavigationTarget?: FocusOverrideTarget;
  sidebarEntryTarget?: FocusOverrideTarget;
}

function getFavoriteLeftTargetId(
  shouldShowCloudSaveButton: boolean,
  shouldShowFavoriteButton: boolean,
  shouldShowCatalogActions: boolean,
  hasPrimaryAction: boolean
): string {
  if (shouldShowCloudSaveButton) return GAME_HERO_OPEN_CLOUD_SAVE_ID;
  if (shouldShowFavoriteButton) return GAME_HERO_OPEN_SETTINGS_ID;
  if (shouldShowCatalogActions && hasPrimaryAction)
    return GAME_HERO_DOWNLOAD_OPTIONS_ID;
  if (hasPrimaryAction) return GAME_HERO_PRIMARY_ACTION_ID;
  return BIG_PICTURE_SIDEBAR_ITEM_IDS.home;
}

function getSettingsLeftTargetId(
  shouldShowCatalogActions: boolean,
  hasPrimaryAction: boolean
): string {
  if (shouldShowCatalogActions) return GAME_HERO_DOWNLOAD_OPTIONS_ID;
  if (hasPrimaryAction) return GAME_HERO_PRIMARY_ACTION_ID;
  return BIG_PICTURE_SIDEBAR_ITEM_IDS.home;
}

export function Hero({
  shopDetails,
  game,
  isGameRunning,
  isFavorite,
  toggleFavorite,
  onPlay,
  onDownload,
  onAddToLibrary,
  onOpenDownloadOptions,
  onOpenSettings,
  onClose,
  isAddingToLibrary,
  canAddToLibrary,
  downNavigationTarget,
  sidebarEntryTarget,
}: Readonly<HeroProps>) {
  const { t } = useTranslation("game_details");
  const heroRef = useRef<HTMLElement | null>(null);
  const currentFocusId = useNavigationStore((state) => state.currentFocusId);

  // The hero is the top of the page, so focusing any of its actions should show
  // it whole rather than stopping wherever it first becomes visible.
  useEffect(() => {
    const hero = heroRef.current;

    if (!hero || !currentFocusId) return;

    const focusedElement = document.getElementById(currentFocusId);

    if (!focusedElement || !hero.contains(focusedElement)) return;

    animateNavigationScrollForElement(hero, { top: 0 });
  }, [currentFocusId]);

  const preferredAssets = useMemo(
    () => resolvePreferredGameAssets(game, shopDetails.assets),
    [game, shopDetails.assets]
  );
  const dominantColor = useDominantColor(preferredAssets.heroSrc || null);
  const { backgroundLayers, getLayerEventHandlers } = useHeroBackgroundLayers(
    preferredAssets.heroSrc || null
  );
  const heroDownNavigationTarget = useMemo<FocusOverrideTarget>(
    () => downNavigationTarget ?? { type: "block" },
    [downNavigationTarget]
  );
  const isPlayableClassicsGame =
    game?.shop === "launchbox" && (game.discs?.length ?? 0) > 0;
  const hasPrimaryAction =
    isGameRunning ||
    Boolean(game?.executablePath) ||
    isPlayableClassicsGame ||
    Boolean(game) ||
    canAddToLibrary;
  const shouldShowCatalogActions = !game && canAddToLibrary;
  const shouldShowFavoriteButton = Boolean(game);
  const shouldShowCloudSaveButton = game?.shop === "steam";
  const lastActionRightTarget = useMemo<FocusOverrideTarget>(
    () => sidebarEntryTarget ?? { type: "block" },
    [sidebarEntryTarget]
  );
  const favoriteLeftTargetId = getFavoriteLeftTargetId(
    shouldShowCloudSaveButton,
    shouldShowFavoriteButton,
    shouldShowCatalogActions,
    hasPrimaryAction
  );

  const toggleFavoriteNavigationOverrides: FocusOverrides = {
    left: {
      type: "item",
      itemId: favoriteLeftTargetId,
    },
    right: lastActionRightTarget,
    down: heroDownNavigationTarget,
  };
  const cloudSaveNavigationOverrides: FocusOverrides = {
    left: {
      type: "item",
      itemId: GAME_HERO_OPEN_SETTINGS_ID,
    },
    right: shouldShowFavoriteButton
      ? {
          type: "item",
          itemId: GAME_HERO_TOGGLE_FAVORITE_ID,
        }
      : lastActionRightTarget,
    down: heroDownNavigationTarget,
  };

  const { primaryActionButton, downloadOptionsButton, settingsButton } =
    useMemo(() => {
      const primaryActionRightTarget = shouldShowCatalogActions
        ? {
            type: "item" as const,
            itemId: GAME_HERO_DOWNLOAD_OPTIONS_ID,
          }
        : shouldShowFavoriteButton
          ? {
              type: "item" as const,
              itemId: GAME_HERO_OPEN_SETTINGS_ID,
            }
          : lastActionRightTarget;
      const primaryActionNavigationOverrides: FocusOverrides = {
        left: {
          type: "item",
          itemId: BIG_PICTURE_SIDEBAR_ITEM_IDS.home,
        },
        right: primaryActionRightTarget,
        down: heroDownNavigationTarget,
      };
      const downloadOptionsNavigationOverrides: FocusOverrides = {
        left: {
          type: "item",
          itemId: GAME_HERO_PRIMARY_ACTION_ID,
        },
        right: shouldShowFavoriteButton
          ? {
              type: "item",
              itemId: GAME_HERO_OPEN_SETTINGS_ID,
            }
          : lastActionRightTarget,
        down: heroDownNavigationTarget,
      };
      const settingsLeftTargetId = getSettingsLeftTargetId(
        shouldShowCatalogActions,
        hasPrimaryAction
      );
      const settingsNavigationOverrides: FocusOverrides = {
        left: {
          type: "item",
          itemId: settingsLeftTargetId,
        },
        right: shouldShowCloudSaveButton
          ? {
              type: "item" as const,
              itemId: GAME_HERO_OPEN_CLOUD_SAVE_ID,
            }
          : shouldShowFavoriteButton
            ? {
                type: "item" as const,
                itemId: GAME_HERO_TOGGLE_FAVORITE_ID,
              }
            : lastActionRightTarget,
        down: heroDownNavigationTarget,
      };

      if (isGameRunning) {
        return {
          primaryActionButton: (
            <Button
              focusId={GAME_HERO_PRIMARY_ACTION_ID}
              focusNavigationOverrides={primaryActionNavigationOverrides}
              variant="primary"
              icon={<XCircleIcon size={24} />}
              onClick={onClose}
            >
              Close Game
            </Button>
          ),
          downloadOptionsButton: null,
          settingsButton: shouldShowFavoriteButton ? (
            <Button
              focusId={GAME_HERO_OPEN_SETTINGS_ID}
              focusNavigationOverrides={settingsNavigationOverrides}
              variant="secondary"
              aria-label={t("options")}
              icon={<GearIcon size={24} />}
              onClick={onOpenSettings}
            >
              {t("options")}
            </Button>
          ) : null,
        };
      }

      if (game?.executablePath || isPlayableClassicsGame) {
        return {
          primaryActionButton: (
            <Button
              focusId={GAME_HERO_PRIMARY_ACTION_ID}
              focusNavigationOverrides={primaryActionNavigationOverrides}
              variant="primary"
              color={dominantColor ?? undefined}
              iconPosition="right"
              icon={<PlayIcon size={24} weight="fill" />}
              onClick={onPlay}
            >
              Launch Game
            </Button>
          ),
          downloadOptionsButton: null,
          settingsButton: shouldShowFavoriteButton ? (
            <Button
              focusId={GAME_HERO_OPEN_SETTINGS_ID}
              focusNavigationOverrides={settingsNavigationOverrides}
              variant="secondary"
              aria-label={t("options")}
              icon={<GearIcon size={24} />}
              onClick={onOpenSettings}
            >
              {t("options")}
            </Button>
          ) : null,
        };
      }

      if (game) {
        return {
          primaryActionButton: (
            <Button
              focusId={GAME_HERO_PRIMARY_ACTION_ID}
              focusNavigationOverrides={primaryActionNavigationOverrides}
              variant="primary"
              color={dominantColor ?? undefined}
              icon={<DownloadSimpleIcon size={24} />}
              onClick={onDownload}
            >
              Download Game
            </Button>
          ),
          downloadOptionsButton: null,
          settingsButton: (
            <Button
              focusId={GAME_HERO_OPEN_SETTINGS_ID}
              focusNavigationOverrides={settingsNavigationOverrides}
              variant="secondary"
              aria-label={t("options")}
              icon={<GearIcon size={24} />}
              onClick={onOpenSettings}
            >
              {t("options")}
            </Button>
          ),
        };
      }

      if (!canAddToLibrary) {
        return {
          primaryActionButton: null,
          downloadOptionsButton: null,
          settingsButton: null,
        };
      }

      return {
        primaryActionButton: (
          <Button
            focusId={GAME_HERO_PRIMARY_ACTION_ID}
            focusNavigationOverrides={primaryActionNavigationOverrides}
            variant="primary"
            color={dominantColor ?? undefined}
            icon={<PlusCircleIcon size={24} />}
            onClick={onAddToLibrary}
            loading={isAddingToLibrary}
          >
            Add to Library
          </Button>
        ),
        downloadOptionsButton: (
          <Button
            focusId={GAME_HERO_DOWNLOAD_OPTIONS_ID}
            focusNavigationOverrides={downloadOptionsNavigationOverrides}
            variant="secondary"
            icon={<DownloadSimpleIcon size={24} />}
            onClick={onOpenDownloadOptions}
          >
            Download Game
          </Button>
        ),
        settingsButton: null,
      };
    }, [
      canAddToLibrary,
      dominantColor,
      game,
      hasPrimaryAction,
      heroDownNavigationTarget,
      isAddingToLibrary,
      isGameRunning,
      isPlayableClassicsGame,
      onAddToLibrary,
      onClose,
      onDownload,
      onOpenDownloadOptions,
      onOpenSettings,
      onPlay,
      shouldShowCatalogActions,
      shouldShowCloudSaveButton,
      shouldShowFavoriteButton,
      lastActionRightTarget,
      t,
    ]);

  return (
    <section
      ref={heroRef}
      className="game-page__hero-shell"
      data-suppress-navigation-autoscroll="true"
    >
      {backgroundLayers.map((layer) => {
        const layerHandlers = getLayerEventHandlers(layer);

        return (
          <div
            key={layer.key}
            className={cn(
              `game-page__hero-bg-layer game-page__hero-bg-layer--${layer.role}`,
              layer.isVisible && "game-page__hero-bg-layer--visible"
            )}
            onTransitionEnd={layerHandlers.onTransitionEnd}
          >
            <AnimatedHeroImage
              className="game-page__hero"
              imageUrl={layer.imageUrl}
              onLoad={layerHandlers.onLoad}
              onError={layerHandlers.onError}
            />
          </div>
        );
      })}

      <div className="game-page__hero-overlay">
        {preferredAssets.logoSrc ? (
          <img
            src={preferredAssets.logoSrc}
            alt={preferredAssets.title}
            className="game-page__hero-logo"
          />
        ) : (
          <h1 className="game-page__hero-title">{preferredAssets.title}</h1>
        )}

        <Typography
          className="game-page__hero-description"
          dangerouslySetInnerHTML={{
            __html: shopDetails.short_description || "",
          }}
        />

        <HorizontalFocusGroup
          regionId={GAME_HERO_ACTIONS_REGION_ID}
          className="game-page__hero-actions"
        >
          {primaryActionButton}
          {downloadOptionsButton}

          {primaryActionButton && settingsButton && (
            <div className="game-page__hero-action-divider">
              <Divider orientation="vertical" color="var(--text-secondary)" />
            </div>
          )}

          {settingsButton}

          {shouldShowCloudSaveButton && (
            <BigPictureCloudSaveHeroButton
              focusNavigationOverrides={cloudSaveNavigationOverrides}
            />
          )}

          {shouldShowFavoriteButton && (
            <Button
              variant="secondary"
              size="icon"
              aria-label={
                isFavorite ? "Remove from favorites" : "Add to favorites"
              }
              onClick={() => toggleFavorite()}
              focusId={GAME_HERO_TOGGLE_FAVORITE_ID}
              focusNavigationOverrides={toggleFavoriteNavigationOverrides}
            >
              {isFavorite ? (
                <HeartIcon size={24} weight="fill" />
              ) : (
                <HeartIcon size={24} />
              )}
            </Button>
          )}
        </HorizontalFocusGroup>
      </div>
    </section>
  );
}
