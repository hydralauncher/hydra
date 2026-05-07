import {
  DownloadSimpleIcon,
  HeartIcon,
  PlayIcon,
  PlusCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import type { LibraryGame, ShopDetailsWithAssets } from "@types";
import { motion } from "framer-motion";
import { DownloadIcon } from "lucide-react";
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
  Tooltip,
  Typography,
} from "../../../common";
import {
  GAME_HERO_ACTIONS_REGION_ID,
  GAME_HERO_DOWNLOAD_OPTIONS_ID,
  GAME_HERO_PRIMARY_ACTION_ID,
  GAME_HERO_TOGGLE_FAVORITE_ID,
  GAME_STATS_REGION_ID,
  GAME_STATS_TITLE_ID,
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
}: Readonly<HeroProps>) {
  const dominantColor = useDominantColor(game?.libraryHeroImageUrl ?? null);
  const heroDownNavigationTarget: FocusOverrideTarget = {
    type: "region",
    regionId: GAME_STATS_REGION_ID,
    entryDirection: "down",
  };
  const hasPrimaryAction =
    isGameRunning ||
    Boolean(game?.executablePath) ||
    Boolean(game) ||
    canAddToLibrary;
  const shouldShowCatalogActions = !game && canAddToLibrary;
  const favoriteLeftTargetId = shouldShowCatalogActions
    ? GAME_HERO_DOWNLOAD_OPTIONS_ID
    : hasPrimaryAction
      ? GAME_HERO_PRIMARY_ACTION_ID
      : BIG_PICTURE_SIDEBAR_ITEM_IDS.home;

  const toggleFavoriteNavigationOverrides: FocusOverrides = {
    left: {
      type: "item",
      itemId: favoriteLeftTargetId,
    },
    right: {
      type: "item",
      itemId: GAME_STATS_TITLE_ID,
    },
    down: heroDownNavigationTarget,
  };

  const { primaryActionButton, downloadOptionsButton } = useMemo(() => {
    const primaryActionRightTargetId = shouldShowCatalogActions
      ? GAME_HERO_DOWNLOAD_OPTIONS_ID
      : GAME_HERO_TOGGLE_FAVORITE_ID;
    const primaryActionNavigationOverrides: FocusOverrides = {
      left: {
        type: "item",
        itemId: BIG_PICTURE_SIDEBAR_ITEM_IDS.home,
      },
      right: {
        type: "item",
        itemId: primaryActionRightTargetId,
      },
      down: heroDownNavigationTarget,
    };
    const downloadOptionsNavigationOverrides: FocusOverrides = {
      left: {
        type: "item",
        itemId: GAME_HERO_PRIMARY_ACTION_ID,
      },
      right: {
        type: "item",
        itemId: GAME_HERO_TOGGLE_FAVORITE_ID,
      },
      down: heroDownNavigationTarget,
    };

    if (isGameRunning) {
      return {
        primaryActionButton: (
          <Button
            focusId={GAME_HERO_PRIMARY_ACTION_ID}
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

    if (game?.executablePath) {
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
            icon={<DownloadIcon size={24} />}
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
          variant="secondary"
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
          Download Options
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
    onAddToLibrary,
    onClose,
    onDownload,
    onOpenDownloadOptions,
    onPlay,
    shouldShowCatalogActions,
  ]);

  return (
    <section style={{ position: "relative", height: 620, overflow: "hidden" }}>
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
          style={{ width: 337 }}
          alt={shopDetails.assets?.title || ""}
        />

        <Typography
          style={{ maxWidth: 512, color: "rgba(255, 255, 255, 0.8)" }}
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

          {primaryActionButton && <Divider orientation="vertical" />}

          <Tooltip
            content={isFavorite ? "Remove from Favorites" : "Add to Favorites"}
          >
            <Button
              variant="secondary"
              onClick={() => toggleFavorite()}
              focusId={GAME_HERO_TOGGLE_FAVORITE_ID}
              focusNavigationOverrides={toggleFavoriteNavigationOverrides}
            >
              <motion.span
                key={isFavorite ? "filled" : "empty"}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {isFavorite ? (
                  <HeartIcon size={24} weight="fill" />
                ) : (
                  <HeartIcon size={24} />
                )}
              </motion.span>
            </Button>
          </Tooltip>
        </HorizontalFocusGroup>
      </div>
    </section>
  );
}
