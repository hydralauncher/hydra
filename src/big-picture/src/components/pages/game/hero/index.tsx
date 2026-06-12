import {
  DownloadSimpleIcon,
  HeartIcon,
  PlayIcon,
  PlusCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import type { LibraryGame, ShopDetailsWithAssets } from "@types";
import { motion } from "framer-motion";
import { useMemo } from "react";
import {
  FocusOverrides,
  FocusOverrideTarget,
} from "src/big-picture/src/services/navigation.service";
import { useDominantColor } from "../../../../hooks";
import { BIG_PICTURE_SIDEBAR_ITEM_IDS } from "../../../../layout";
import {
  Button,
  Divider,
  HorizontalFocusGroup,
  Typography,
} from "../../../common";
import {
  GAME_HERO_ACTIONS_REGION_ID,
  GAME_HERO_DOWNLOAD_OPTIONS_ID,
  GAME_HERO_PRIMARY_ACTION_ID,
  GAME_HERO_TOGGLE_FAVORITE_ID,
} from "../navigation";

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
  onClose: () => void;
  isAddingToLibrary: boolean;
  canAddToLibrary: boolean;
  downNavigationTarget?: FocusOverrideTarget;
  sidebarEntryTarget?: FocusOverrideTarget;
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
  onClose,
  isAddingToLibrary,
  canAddToLibrary,
  downNavigationTarget,
  sidebarEntryTarget,
}: Readonly<HeroProps>) {
  const dominantColor = useDominantColor(
    game?.libraryHeroImageUrl ?? shopDetails.assets?.libraryHeroImageUrl ?? null
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
  const lastActionRightTarget = useMemo<FocusOverrideTarget>(
    () => sidebarEntryTarget ?? { type: "block" },
    [sidebarEntryTarget]
  );
  const favoriteLeftTargetId =
    shouldShowCatalogActions && hasPrimaryAction
      ? GAME_HERO_DOWNLOAD_OPTIONS_ID
      : hasPrimaryAction
        ? GAME_HERO_PRIMARY_ACTION_ID
        : BIG_PICTURE_SIDEBAR_ITEM_IDS.home;

  const toggleFavoriteNavigationOverrides: FocusOverrides = {
    left: {
      type: "item",
      itemId: favoriteLeftTargetId,
    },
    right: lastActionRightTarget,
    down: heroDownNavigationTarget,
  };

  const { primaryActionButton, downloadOptionsButton } = useMemo(() => {
    const primaryActionRightTarget = shouldShowCatalogActions
      ? {
          type: "item" as const,
          itemId: GAME_HERO_DOWNLOAD_OPTIONS_ID,
        }
      : shouldShowFavoriteButton
        ? {
            type: "item" as const,
            itemId: GAME_HERO_TOGGLE_FAVORITE_ID,
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
      };
    }

    if (!canAddToLibrary) {
      return {
        primaryActionButton: null,
        downloadOptionsButton: null,
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
    };
  }, [
    canAddToLibrary,
    dominantColor,
    game,
    heroDownNavigationTarget,
    isAddingToLibrary,
    isGameRunning,
    isPlayableClassicsGame,
    onAddToLibrary,
    onClose,
    onDownload,
    onOpenDownloadOptions,
    onPlay,
    shouldShowCatalogActions,
    shouldShowFavoriteButton,
    lastActionRightTarget,
  ]);

  return (
    <section className="game-page__hero-shell">
      <motion.div
        initial={{ scale: 1, x: 0, y: 0 }}
        animate={{
          scale: 1.1,
          x: -10,
          y: -10,
        }}
        transition={{
          duration: 20,
          ease: "easeInOut",
          repeat: Infinity,
          repeatType: "mirror",
        }}
        className="game-page__hero"
        style={{
          backgroundImage: `url(${shopDetails.assets?.libraryHeroImageUrl})`,
        }}
      />

      <div className="game-page__hero-overlay">
        <img
          src={shopDetails.assets?.logoImageUrl || ""}
          alt={shopDetails.assets?.title || ""}
          className="game-page__hero-logo"
        />

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

          {primaryActionButton && shouldShowFavoriteButton && (
            <div className="game-page__hero-action-divider">
              <Divider orientation="vertical" color="var(--text-secondary)" />
            </div>
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
