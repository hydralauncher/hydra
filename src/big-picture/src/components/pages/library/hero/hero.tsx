import type { LibraryGame } from "@types";
import {
  ClockIcon,
  DownloadSimpleIcon,
  GearIcon,
  HeartIcon,
  PlayIcon,
  TrophyIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import cn from "classnames";
import {
  Button,
  AnimatedHeroImage,
  Divider,
  HorizontalFocusGroup,
} from "../../../common";
import { formatRelativeDate } from "../../../../helpers";
import { useDominantColor } from "../../../../hooks";
import { type FocusOverrides } from "../../../../services";
import { BIG_PICTURE_SIDEBAR_ITEM_IDS } from "../../../../layout";
import {
  LIBRARY_FILTERS_SEARCH_INPUT_ID,
  LIBRARY_HERO_ACTIONS_REGION_ID,
  LIBRARY_HERO_FAVORITE_BUTTON_ID,
  LIBRARY_HERO_LAUNCH_BUTTON_ID,
  LIBRARY_HERO_OPTIONS_BUTTON_ID,
} from "../navigation";
import { getHeroPlaytimeLabel } from "../library-data";
import { useLibraryLaunchGame } from "../use-library-launch-game";
import { useHeroBackgroundLayers } from "./use-hero-background-layers";

import "./hero.scss";

interface LibraryHeroProps {
  lastPlayedGames: LibraryGame[];
  onOpenGameSettings?: (game: LibraryGame) => void;
  onToggleFavorite?: (game: LibraryGame) => Promise<void> | void;
  favoriteLoadingGameId?: string | null;
}

const FEATURED_GAME_INTERVAL = 60000;

function getLastPlayedLabel(lastTimePlayed: Date | string | null | undefined) {
  const relativeDate = formatRelativeDate(lastTimePlayed, {
    fallback: "recently",
  });

  return `Last played ${relativeDate}`;
}

export function LibraryHero({
  lastPlayedGames,
  onOpenGameSettings,
  onToggleFavorite,
  favoriteLoadingGameId = null,
}: Readonly<LibraryHeroProps>) {
  const [featuredGameIndex, setFeaturedGameIndex] = useState(0);
  const heroRef = useRef<HTMLElement | null>(null);
  const featuredGame = lastPlayedGames[featuredGameIndex] ?? null;
  const launchGame = useLibraryLaunchGame(
    useCallback(() => {
      console.log("library-hero download");
    }, [])
  );
  const getHeroScrollAnchor = useCallback(() => heroRef.current, []);
  const dominantColor = useDominantColor(
    featuredGame?.libraryHeroImageUrl ?? null
  );
  const { backgroundLayers, getLayerEventHandlers } = useHeroBackgroundLayers(
    featuredGame?.libraryHeroImageUrl
  );

  useEffect(() => {
    if (lastPlayedGames.length <= 1) {
      setFeaturedGameIndex(0);
      return;
    }

    const intervalId = globalThis.setInterval(() => {
      setFeaturedGameIndex((currentIndex) => {
        return (currentIndex + 1) % lastPlayedGames.length;
      });
    }, FEATURED_GAME_INTERVAL);

    return () => {
      globalThis.clearInterval(intervalId);
    };
  }, [lastPlayedGames]);

  const achievementCount =
    featuredGame?.unlockedAchievementCount ??
    featuredGame?.achievementCount ??
    0;
  const playtime = getHeroPlaytimeLabel(featuredGame?.playTimeInMilliseconds);
  const lastPlayedLabel = getLastPlayedLabel(featuredGame?.lastTimePlayed);
  const isFavoriteLoading =
    Boolean(featuredGame) && favoriteLoadingGameId === featuredGame?.id;
  const hasExecutable = Boolean(featuredGame?.executablePath);

  const handlePlayOrDownloadClick = () => {
    if (!featuredGame) return;
    void launchGame(featuredGame);
  };

  const heroActionsNavigationOverrides: FocusOverrides = {
    down: {
      type: "item",
      itemId: LIBRARY_FILTERS_SEARCH_INPUT_ID,
    },
  };
  const sidebarLibraryOverride = {
    type: "item",
    itemId: BIG_PICTURE_SIDEBAR_ITEM_IDS.library,
  } as const;
  const launchNavigationOverrides: FocusOverrides = {
    left: sidebarLibraryOverride,
    right: { type: "item", itemId: LIBRARY_HERO_OPTIONS_BUTTON_ID },
    down: { type: "item", itemId: LIBRARY_FILTERS_SEARCH_INPUT_ID },
  };
  const optionsNavigationOverrides: FocusOverrides = {
    left: { type: "item", itemId: LIBRARY_HERO_LAUNCH_BUTTON_ID },
    right: { type: "item", itemId: LIBRARY_HERO_FAVORITE_BUTTON_ID },
    down: { type: "item", itemId: LIBRARY_FILTERS_SEARCH_INPUT_ID },
  };
  const favoriteNavigationOverrides: FocusOverrides = {
    left: { type: "item", itemId: LIBRARY_HERO_OPTIONS_BUTTON_ID },
    right: { type: "block" },
    down: { type: "item", itemId: LIBRARY_FILTERS_SEARCH_INPUT_ID },
  };

  return (
    <section ref={heroRef} className="hero">
      {backgroundLayers.map((layer) => {
        const layerHandlers = getLayerEventHandlers(layer);

        return (
          <div
            key={layer.key}
            className={cn(
              `hero__bg-layer hero__bg-layer--${layer.role}`,
              layer.isVisible && "hero__bg-layer--visible"
            )}
            onTransitionEnd={layerHandlers.onTransitionEnd}
          >
            <AnimatedHeroImage
              className="hero__bg"
              imageUrl={layer.imageUrl}
              onLoad={layerHandlers.onLoad}
              onError={layerHandlers.onError}
            />
          </div>
        );
      })}

      <div className="hero__overlay" />

      <div className="hero__content">
        <div className="hero__content__left">
          <div className="hero__logo">
            {featuredGame?.logoImageUrl ? (
              <img
                src={featuredGame.logoImageUrl}
                alt={featuredGame.title}
                className="hero__logo__image"
              />
            ) : (
              <span className="hero__logo__fallback">
                {featuredGame?.title ?? ""}
              </span>
            )}
          </div>

          <div className="hero__copy">
            <p className="hero__eyebrow">Continue playing:</p>
            <p className="hero__description">{lastPlayedLabel}</p>
          </div>

          <div className="hero__actions">
            <HorizontalFocusGroup
              regionId={LIBRARY_HERO_ACTIONS_REGION_ID}
              navigationOverrides={heroActionsNavigationOverrides}
              getScrollAnchor={getHeroScrollAnchor}
            >
              {hasExecutable ? (
                <Button
                  variant="primary"
                  icon={<PlayIcon size={24} weight="fill" />}
                  color={dominantColor ?? undefined}
                  focusId={LIBRARY_HERO_LAUNCH_BUTTON_ID}
                  focusNavigationOverrides={launchNavigationOverrides}
                  disabled={!featuredGame}
                  onClick={handlePlayOrDownloadClick}
                >
                  Launch Game
                </Button>
              ) : (
                <Button
                  variant="primary"
                  icon={<DownloadSimpleIcon size={24} />}
                  color={dominantColor ?? undefined}
                  focusId={LIBRARY_HERO_LAUNCH_BUTTON_ID}
                  focusNavigationOverrides={launchNavigationOverrides}
                  disabled={!featuredGame}
                  onClick={handlePlayOrDownloadClick}
                >
                  Launch Game
                </Button>
              )}

              <div className="hero__action__divider">
                <Divider orientation="vertical" color="var(--text-secondary)" />
              </div>

              <Button
                variant="secondary"
                icon={<GearIcon size={24} />}
                focusId={LIBRARY_HERO_OPTIONS_BUTTON_ID}
                focusNavigationOverrides={optionsNavigationOverrides}
                onClick={() => {
                  if (featuredGame) {
                    onOpenGameSettings?.(featuredGame);
                  }
                }}
              >
                Options
              </Button>

              <Button
                variant="secondary"
                size="icon"
                focusId={LIBRARY_HERO_FAVORITE_BUTTON_ID}
                focusNavigationOverrides={favoriteNavigationOverrides}
                aria-label={
                  featuredGame?.favorite
                    ? "Remove from favorites"
                    : "Add to favorites"
                }
                disabled={!featuredGame}
                loading={isFavoriteLoading}
                onClick={() => {
                  if (featuredGame) {
                    void onToggleFavorite?.(featuredGame);
                  }
                }}
              >
                {featuredGame?.favorite ? (
                  <HeartIcon size={24} weight="fill" />
                ) : (
                  <HeartIcon size={24} />
                )}
              </Button>
            </HorizontalFocusGroup>
          </div>
        </div>

        <div className="hero__stats">
          <div className="hero__stat hero__stat--achievements">
            <div className="hero__stat__value">
              <TrophyIcon size={28} />
              <span>{achievementCount}</span>
            </div>

            <div className="hero__stat__label">Achievements</div>
          </div>

          <div className="hero__stat hero__stat--playtime">
            <div className="hero__stat__value">
              <ClockIcon size={28} />
              <span>{playtime}</span>
            </div>
            <div className="hero__stat__label">Hours Played</div>
          </div>
        </div>
      </div>
    </section>
  );
}
