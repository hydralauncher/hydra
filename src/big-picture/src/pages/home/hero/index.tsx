import {
  DownloadSimpleIcon,
  PlayIcon,
  PlusCircleIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import type { TrendingGame } from "@types";
import { useNavigate } from "react-router-dom";
import cn from "classnames";
import {
  AnimatedHeroImage,
  Button,
  HorizontalFocusGroup,
} from "../../../components";
import { useLibraryLaunchGame } from "../../../components/pages/library/use-library-launch-game";
import { useHeroBackgroundLayers } from "../../../components/pages/library/hero/use-hero-background-layers";
import { getBigPictureGameDetailsPath } from "../../../helpers";
import { useDominantColor, useLibraryGameState } from "../../../hooks";
import { BIG_PICTURE_SIDEBAR_ITEM_IDS } from "../../../layout";
import type { FocusOverrideTarget, FocusOverrides } from "../../../services";
import {
  HOME_HERO_ACTIONS_REGION_ID,
  HOME_HERO_ADD_TO_LIBRARY_ID,
  HOME_HERO_DOWNLOAD_ID,
  HOME_HERO_OPEN_GAME_PAGE_ID,
  HOME_POPULAR_GAMES_ROW_REGION_ID,
} from "../navigation";

import "./styles.scss";

interface HomePageHeroProps {
  featuredGame: TrendingGame | null;
}

export function HomePageHero({ featuredGame }: Readonly<HomePageHeroProps>) {
  const navigate = useNavigate();
  const { updateLibrary, ...gameState } = useLibraryGameState(
    featuredGame?.shop,
    featuredGame?.objectId
  );
  const launchGame = useLibraryLaunchGame(
    useCallback(() => {
      console.log("home-hero download");
    }, [])
  );
  const [isAddingToLibrary, setIsAddingToLibrary] = useState(false);
  const [shouldShowLogoFallback, setShouldShowLogoFallback] = useState(false);
  const { backgroundLayers, getLayerEventHandlers } = useHeroBackgroundLayers(
    featuredGame?.libraryHeroImageUrl
  );
  const dominantColor = useDominantColor(
    featuredGame?.libraryHeroImageUrl ?? null
  );
  const isInLibrary = gameState.isInLibrary;
  const secondActionFocusId = isInLibrary
    ? HOME_HERO_DOWNLOAD_ID
    : HOME_HERO_ADD_TO_LIBRARY_ID;

  useEffect(() => {
    updateLibrary();
  }, [updateLibrary]);

  useEffect(() => {
    setShouldShowLogoFallback(false);
  }, [featuredGame?.logoImageUrl]);

  const openGamePage = () => {
    if (!featuredGame) return;
    void navigate(
      getBigPictureGameDetailsPath({
        shop: featuredGame.shop,
        objectId: featuredGame.objectId,
        title: featuredGame.title,
      })
    );
  };

  const handleDownloadOrPlayClick = () => {
    if (!gameState.libraryGame) {
      console.log("home-hero download");
      return;
    }
    void launchGame(gameState.libraryGame);
  };

  const handleAddToLibrary = async () => {
    if (!featuredGame || isInLibrary || isAddingToLibrary) return;

    setIsAddingToLibrary(true);

    try {
      await globalThis.window.electron.addGameToLibrary(
        featuredGame.shop,
        featuredGame.objectId,
        featuredGame.title
      );
      await updateLibrary();
    } finally {
      setIsAddingToLibrary(false);
    }
  };

  if (!featuredGame) return null;

  const heroDownNavigationTarget: FocusOverrideTarget = {
    type: "region",
    regionId: HOME_POPULAR_GAMES_ROW_REGION_ID,
    entryDirection: "right",
  };

  const addToLibraryNavigationOverrides: FocusOverrides = {
    left: {
      type: "item",
      itemId: HOME_HERO_OPEN_GAME_PAGE_ID,
    },
    right: {
      type: "block",
    },
    down: heroDownNavigationTarget,
  };

  const downloadOrPlayNavigationOverrides: FocusOverrides = {
    left: {
      type: "item",
      itemId: HOME_HERO_OPEN_GAME_PAGE_ID,
    },
    right: {
      type: "block",
    },
    down: heroDownNavigationTarget,
  };

  const openGamePageNavigationOverrides: FocusOverrides = {
    left: {
      type: "item",
      itemId: BIG_PICTURE_SIDEBAR_ITEM_IDS.home,
    },
    right: {
      type: "item",
      itemId: secondActionFocusId,
    },
    down: heroDownNavigationTarget,
  };

  return (
    <section className="home-page-hero" aria-label={featuredGame.title}>
      {backgroundLayers.map((layer) => {
        const layerHandlers = getLayerEventHandlers(layer);

        return (
          <div
            key={layer.key}
            className={cn(
              `home-page-hero__bg-layer home-page-hero__bg-layer--${layer.role}`,
              layer.isVisible && "home-page-hero__bg-layer--visible"
            )}
            onTransitionEnd={layerHandlers.onTransitionEnd}
          >
            <AnimatedHeroImage
              className="home-page-hero__bg"
              imageUrl={layer.imageUrl}
              onLoad={layerHandlers.onLoad}
              onError={layerHandlers.onError}
            />
          </div>
        );
      })}

      <div className="home-page-hero__overlay" />

      <div className="home-page-hero__content">
        <div className="home-page-hero__main">
          <div className="home-page-hero__logo">
            {featuredGame.logoImageUrl && !shouldShowLogoFallback ? (
              <img
                src={featuredGame.logoImageUrl}
                alt={featuredGame.title}
                className="home-page-hero__logo-image"
                onError={() => setShouldShowLogoFallback(true)}
              />
            ) : (
              <span className="home-page-hero__logo-fallback">
                {featuredGame.title}
              </span>
            )}
          </div>

          {featuredGame.description && (
            <p className="home-page-hero__description">
              {featuredGame.description}
            </p>
          )}

          <HorizontalFocusGroup
            className="home-page-hero__actions"
            regionId={HOME_HERO_ACTIONS_REGION_ID}
          >
            <Button
              focusId={HOME_HERO_OPEN_GAME_PAGE_ID}
              focusNavigationOverrides={openGamePageNavigationOverrides}
              color={dominantColor ?? undefined}
              onClick={openGamePage}
              size="large"
              variant="primary"
            >
              View Details
            </Button>

            {!isInLibrary ? (
              <Button
                focusId={HOME_HERO_ADD_TO_LIBRARY_ID}
                focusNavigationOverrides={addToLibraryNavigationOverrides}
                icon={<PlusCircleIcon size={24} />}
                onClick={() => void handleAddToLibrary()}
                loading={isAddingToLibrary}
                size="large"
                variant="secondary"
              >
                Add to Library
              </Button>
            ) : gameState.hasExecutable ? (
              <Button
                focusId={HOME_HERO_DOWNLOAD_ID}
                focusNavigationOverrides={downloadOrPlayNavigationOverrides}
                icon={<PlayIcon size={24} weight="fill" />}
                onClick={handleDownloadOrPlayClick}
                size="large"
                variant="primary"
              >
                Play
              </Button>
            ) : (
              <Button
                focusId={HOME_HERO_DOWNLOAD_ID}
                focusNavigationOverrides={downloadOrPlayNavigationOverrides}
                icon={<DownloadSimpleIcon size={24} />}
                onClick={handleDownloadOrPlayClick}
                size="large"
                variant="primary"
              >
                Download Game
              </Button>
            )}
          </HorizontalFocusGroup>
        </div>
      </div>
    </section>
  );
}
