import {
  CheckCircleIcon,
  DownloadSimpleIcon,
  PlusCircleIcon,
} from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import cn from "classnames";
import {
  AnimatedHeroImage,
  Button,
  HorizontalFocusGroup,
} from "../../../components";
import { useHeroBackgroundLayers } from "../../../components/pages/library/hero/use-hero-background-layers";
import { useLibrary } from "../../../hooks";
import { BIG_PICTURE_SIDEBAR_ITEM_IDS } from "../../../layout";
import type { FocusOverrides } from "../../../services";
import {
  HOME_HERO_ACTIONS_REGION_ID,
  HOME_HERO_ADD_TO_LIBRARY_ID,
  HOME_HERO_DOWNLOAD_ID,
} from "../navigation";
import { useFeaturedGame } from "./use-featured-game";

import "./styles.scss";

interface HomePageHeroProps {
  firstPopularGameId?: string | null;
}

export function HomePageHero({
  firstPopularGameId,
}: Readonly<HomePageHeroProps>) {
  const navigate = useNavigate();
  const { library, updateLibrary } = useLibrary();
  const { featuredGame } = useFeaturedGame();
  const [isAddingToLibrary, setIsAddingToLibrary] = useState(false);
  const [shouldShowLogoFallback, setShouldShowLogoFallback] = useState(false);
  const { backgroundLayers, getLayerEventHandlers } = useHeroBackgroundLayers(
    featuredGame?.libraryHeroImageUrl
  );
  const isInLibrary = Boolean(
    featuredGame &&
      library.some(
        (game) =>
          game.shop === featuredGame.shop &&
          game.objectId === featuredGame.objectId
      )
  );

  useEffect(() => {
    updateLibrary();
  }, [updateLibrary]);

  useEffect(() => {
    setShouldShowLogoFallback(false);
  }, [featuredGame?.logoImageUrl]);

  const handleOpenFeaturedGame = () => {
    if (!featuredGame) return;

    navigate(featuredGame.uri);
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

  const heroDownNavigationTarget = firstPopularGameId
    ? ({ type: "item", itemId: firstPopularGameId } as const)
    : ({ type: "block" } as const);

  const addToLibraryNavigationOverrides: FocusOverrides = {
    left: {
      type: "item",
      itemId: BIG_PICTURE_SIDEBAR_ITEM_IDS.home,
    },
    right: {
      type: "item",
      itemId: HOME_HERO_DOWNLOAD_ID,
    },
    down: heroDownNavigationTarget,
  };

  const downloadNavigationOverrides: FocusOverrides = {
    left: {
      type: "item",
      itemId: HOME_HERO_ADD_TO_LIBRARY_ID,
    },
    right: {
      type: "block",
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
              focusId={HOME_HERO_ADD_TO_LIBRARY_ID}
              focusNavigationOverrides={addToLibraryNavigationOverrides}
              icon={
                isInLibrary ? (
                  <CheckCircleIcon size={24} weight="fill" />
                ) : (
                  <PlusCircleIcon size={24} />
                )
              }
              onClick={() => void handleAddToLibrary()}
              loading={isAddingToLibrary}
              disabled={isInLibrary}
              size="large"
              variant="secondary"
            >
              {isInLibrary ? "In Library" : "Add to Library"}
            </Button>

            <Button
              focusId={HOME_HERO_DOWNLOAD_ID}
              focusNavigationOverrides={downloadNavigationOverrides}
              icon={<DownloadSimpleIcon size={24} />}
              onClick={handleOpenFeaturedGame}
              size="large"
            >
              Download Game
            </Button>
          </HorizontalFocusGroup>
        </div>
      </div>
    </section>
  );
}
