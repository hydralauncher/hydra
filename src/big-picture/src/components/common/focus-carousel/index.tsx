import type { ShopAssets } from "@types";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import useEmblaCarousel from "embla-carousel-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  MouseEventHandler,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { useDominantColor, useGamepad } from "../../../hooks";
import type { FocusOverrides } from "../../../services";
import { useNavigationIsFocused, useNavigationStore } from "../../../stores";
import { GamepadAxisType, GamepadButtonType } from "../../../types";
import { FocusItem } from "../focus-item";
import { HorizontalFocusGroup } from "../horizontal-focus-group";
import { HorizontalStoreGameCard } from "../horizontal-store-game-card";
import { VerticalGameCard } from "../vertical-game-card";
import { VerticalStoreGameCard } from "../vertical-store-game-card";
import {
  getGameCoverImageSource,
  getGameIdentityKey,
  getGameLandscapeImageSource,
  getOptionalItemFocusTarget,
} from "../../../helpers";
import {
  ClassicsCoverBadges,
  ClassicsVerticalCoverMedia,
  useFocusAnimatedCover,
  useLibraryGameCardPresentation,
} from "../../pages/library/card-presentation";
import { getDirectionBiasedFocusIndexes } from "./focus-targets";

import "./styles.scss";

const FADE_TRANSITION_MS = 120;
const PARTIAL_VISIBLE_SLIDE_RATIO = 0.5;
const SLIDE_MEASUREMENT_EPSILON_PX = 1;
const LEFT_INPUT_HELD_THRESHOLD = -0.5;
const CLICK_DRAG_THRESHOLD_PX = 8;

type FadeSide = "left" | "right";
type FocusCarouselCardMode = "store" | "library";
type EmblaApi = ReturnType<typeof useEmblaCarousel>[1];
type ResolvedEmblaApi = NonNullable<EmblaApi>;

interface FocusCarouselGame extends ShopAssets {
  platform?: string | null;
  customIconUrl?: string | null;
  customHeroImageUrl?: string | null;
  customLogoImageUrl?: string | null;
  playTimeInMilliseconds?: number | null;
  achievementCount?: number | null;
  unlockedAchievementCount?: number | null;
}

interface FocusCarouselProps {
  title?: string;
  headerMeta?: ReactNode;
  games: FocusCarouselGame[];
  regionId?: string;
  showRightFade?: boolean;
  cardMode?: FocusCarouselCardMode;
  cardVariant?: "vertical" | "horizontal";
  getItemId?: (game: FocusCarouselGame) => string;
  onItemActivate?: (game: FocusCarouselGame) => void;
  controlsNavigation?: {
    regionId: string;
    previousId: string;
    nextId: string;
    navigationOverrides?: FocusOverrides;
  };
  getItemNavigationOverrides?: (
    game: FocusCarouselGame,
    index: number,
    games: FocusCarouselGame[]
  ) => FocusOverrides | undefined;
  onCarouselItemOpenContextMenu?: (
    game: FocusCarouselGame,
    position: { x: number; y: number },
    restoreFocusId: string
  ) => void;
}

interface FocusCarouselSlideProps {
  game: FocusCarouselGame;
  index: number;
  itemId: string;
  cardMode: FocusCarouselCardMode;
  cardVariant: "vertical" | "horizontal";
  navigationOverrides?: FocusOverrides;
  onFocused: () => void;
  onActivate?: (game: FocusCarouselGame) => void;
  onCardClick?: (game: FocusCarouselGame) => void;
  onCarouselItemOpenContextMenu?: (
    game: FocusCarouselGame,
    position: { x: number; y: number },
    restoreFocusId: string
  ) => void;
}

function getDefaultItemNavigationOverrides(
  index: number,
  games: FocusCarouselGame[],
  getItemId?: (game: FocusCarouselGame) => string
): FocusOverrides {
  const previousGame = games[index - 1];
  const nextGame = games[index + 1];

  const leftTarget = previousGame ? getItemId?.(previousGame) : undefined;
  const rightTarget = nextGame ? getItemId?.(nextGame) : undefined;

  return {
    left: getOptionalItemFocusTarget(leftTarget),
    right: getOptionalItemFocusTarget(rightTarget),
  };
}

function mergeNavigationOverrides(
  base: FocusOverrides,
  custom?: FocusOverrides
): FocusOverrides | undefined {
  const merged: FocusOverrides = {
    ...base,
    ...custom,
  };

  return Object.values(merged).some(Boolean) ? merged : undefined;
}

function getSlideStep(slideRects: DOMRect[]) {
  if (slideRects.length <= 1) return slideRects[0]?.width ?? 0;

  const step = slideRects[1].left - slideRects[0].left;

  if (step <= SLIDE_MEASUREMENT_EPSILON_PX) {
    return slideRects[0]?.width ?? 0;
  }

  return step;
}

function getVisibleCapacity(
  viewportWidth: number,
  slideWidth: number,
  slideStep: number
) {
  if (viewportWidth <= 0 || slideWidth <= 0 || slideStep <= 0) {
    return 0;
  }

  const fullVisibleCount =
    viewportWidth + SLIDE_MEASUREMENT_EPSILON_PX >= slideWidth
      ? Math.floor(
          (viewportWidth - slideWidth + SLIDE_MEASUREMENT_EPSILON_PX) /
            slideStep
        ) + 1
      : 0;

  const remainingWidth = viewportWidth - fullVisibleCount * slideStep;
  const hasHalfVisibleTrailingSlide =
    remainingWidth + SLIDE_MEASUREMENT_EPSILON_PX >=
    slideWidth * PARTIAL_VISIBLE_SLIDE_RATIO;

  return Math.max(1, fullVisibleCount + (hasHalfVisibleTrailingSlide ? 1 : 0));
}

function getViewportSlideMetrics(emblaApi: ResolvedEmblaApi): {
  firstVisibleIndex: number;
  visibleCount: number;
  visibleIndexes: number[];
} | null {
  const viewportRect = emblaApi.rootNode().getBoundingClientRect();
  const slideRects = emblaApi
    .slideNodes()
    .map((slideNode) => slideNode.getBoundingClientRect());

  if (slideRects.length === 0) return null;

  const slideWidth = slideRects[0]?.width ?? 0;
  const slideStep = getSlideStep(slideRects);

  if (slideWidth <= 0 || slideStep <= 0) return null;

  const visibleIndexes = slideRects.reduce<number[]>(
    (indexes, slideRect, index) => {
      const visibleWidth = Math.max(
        0,
        Math.min(slideRect.right, viewportRect.right) -
          Math.max(slideRect.left, viewportRect.left)
      );

      if (
        visibleWidth + SLIDE_MEASUREMENT_EPSILON_PX >=
        slideRect.width * PARTIAL_VISIBLE_SLIDE_RATIO
      ) {
        indexes.push(index);
      }

      return indexes;
    },
    []
  );

  if (visibleIndexes.length === 0) return null;

  const firstVisibleIndex = visibleIndexes[0];
  const visibleCount = Math.max(
    1,
    Math.min(
      getVisibleCapacity(viewportRect.width, slideWidth, slideStep),
      slideRects.length - firstVisibleIndex
    )
  );

  return {
    firstVisibleIndex,
    visibleCount,
    visibleIndexes,
  };
}

function syncThresholdFocusScroll(
  emblaApi: ResolvedEmblaApi,
  previousFocusedIndex: number | null,
  nextFocusedIndex: number
) {
  const didNotChange =
    previousFocusedIndex == null || previousFocusedIndex === nextFocusedIndex;

  if (didNotChange) return;

  const viewportMetrics = getViewportSlideMetrics(emblaApi);

  if (!viewportMetrics) return;

  const { firstVisibleIndex, visibleCount } = viewportMetrics;
  const visiblePositionOneBased = nextFocusedIndex - firstVisibleIndex + 1;
  const isMovingRight = nextFocusedIndex > previousFocusedIndex;
  const rightTriggerPosition = Math.max(1, Math.ceil(visibleCount / 2));
  const leftTriggerPosition = Math.min(
    visibleCount,
    Math.floor(visibleCount / 2) + 1
  );

  const isOutOfBounds =
    visiblePositionOneBased < 1 || visiblePositionOneBased > visibleCount;

  if (isOutOfBounds) {
    const selectedPosition = Math.floor(visibleCount / 2) + 1;
    const slideCount = emblaApi.slideNodes().length;
    const maxStartIndex = Math.max(0, slideCount - visibleCount);
    const targetStartIndex = Math.max(
      0,
      Math.min(nextFocusedIndex - (selectedPosition - 1), maxStartIndex)
    );

    if (viewportMetrics.firstVisibleIndex !== targetStartIndex) {
      emblaApi.scrollTo(targetStartIndex, true);
    }

    return;
  }

  const didScroll = isMovingRight
    ? visiblePositionOneBased > rightTriggerPosition && emblaApi.canScrollNext()
    : visiblePositionOneBased < leftTriggerPosition && emblaApi.canScrollPrev();

  if (!didScroll) return;

  if (isMovingRight) emblaApi.scrollNext();
  else emblaApi.scrollPrev();
}

function getFadeSide(
  emblaApi: ResolvedEmblaApi | undefined,
  showRightFade: boolean
): FadeSide | null {
  if (!showRightFade || !emblaApi) return null;

  if (emblaApi.canScrollNext()) return "right";
  if (emblaApi.canScrollPrev()) return "left";

  return null;
}

function useThresholdFocusScroll(emblaApi: EmblaApi) {
  const lastFocusedIndexRef = useRef<number | null>(null);

  const handleFocused = useCallback(
    (nextFocusedIndex: number) => {
      const previousFocusedIndex = lastFocusedIndexRef.current;
      lastFocusedIndexRef.current = nextFocusedIndex;

      if (!emblaApi) return;

      syncThresholdFocusScroll(
        emblaApi,
        previousFocusedIndex,
        nextFocusedIndex
      );
    },
    [emblaApi]
  );

  const reset = useCallback(() => {
    lastFocusedIndexRef.current = null;
  }, []);

  return { handleFocused, reset };
}

function useLeftExitLock(firstItemId: string | undefined) {
  const currentFocusId = useNavigationStore((state) => state.currentFocusId);
  const { getAxisValue, isButtonPressed } = useGamepad();
  const [isKeyboardLeftHeld, setIsKeyboardLeftHeld] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const isFirstItemFocused =
    firstItemId !== undefined && currentFocusId === firstItemId;
  const isLeftHeld =
    isKeyboardLeftHeld ||
    isButtonPressed(GamepadButtonType.DPAD_LEFT) ||
    getAxisValue(GamepadAxisType.LEFT_STICK_X) <= LEFT_INPUT_HELD_THRESHOLD;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();

      if (event.key === "ArrowLeft" || key === "a") {
        setIsKeyboardLeftHeld(true);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();

      if (event.key === "ArrowLeft" || key === "a") {
        setIsKeyboardLeftHeld(false);
      }
    };

    const handleWindowBlur = () => {
      setIsKeyboardLeftHeld(false);
    };

    globalThis.addEventListener("keydown", handleKeyDown);
    globalThis.addEventListener("keyup", handleKeyUp);
    globalThis.addEventListener("blur", handleWindowBlur);

    return () => {
      globalThis.removeEventListener("keydown", handleKeyDown);
      globalThis.removeEventListener("keyup", handleKeyUp);
      globalThis.removeEventListener("blur", handleWindowBlur);
    };
  }, []);

  useEffect(() => {
    if (!isLeftHeld) {
      setIsLocked(false);
      return;
    }

    if (isFirstItemFocused) {
      setIsLocked(true);
    }
  }, [isFirstItemFocused, isLeftHeld]);

  return isLocked;
}

function useFadePresence(fadeSide: FadeSide | null) {
  const [renderedFadeSide, setRenderedFadeSide] = useState<FadeSide | null>(
    null
  );
  const [isFadeVisible, setIsFadeVisible] = useState(false);
  const fadeTimeoutRef = useRef<ReturnType<
    typeof globalThis.setTimeout
  > | null>(null);
  const fadeFrameRef = useRef<number | null>(null);

  const clearPendingFade = useCallback(() => {
    if (fadeTimeoutRef.current != null) {
      globalThis.clearTimeout(fadeTimeoutRef.current);
      fadeTimeoutRef.current = null;
    }

    if (fadeFrameRef.current != null) {
      globalThis.cancelAnimationFrame(fadeFrameRef.current);
      fadeFrameRef.current = null;
    }
  }, []);

  const scheduleFadeIn = useCallback(() => {
    fadeFrameRef.current = globalThis.requestAnimationFrame(() => {
      setIsFadeVisible(true);
      fadeFrameRef.current = null;
    });
  }, []);

  const showFade = useCallback(
    (nextFadeSide: FadeSide) => {
      setRenderedFadeSide(nextFadeSide);
      scheduleFadeIn();
    },
    [scheduleFadeIn]
  );

  useEffect(() => clearPendingFade, [clearPendingFade]);

  useEffect(() => {
    clearPendingFade();

    if (fadeSide == null) {
      setIsFadeVisible(false);

      if (renderedFadeSide == null) return;

      fadeTimeoutRef.current = globalThis.setTimeout(() => {
        setRenderedFadeSide(null);
        fadeTimeoutRef.current = null;
      }, FADE_TRANSITION_MS);

      return;
    }

    if (renderedFadeSide == null) showFade(fadeSide);
    if (renderedFadeSide === fadeSide) setIsFadeVisible(true);

    setIsFadeVisible(false);
    fadeTimeoutRef.current = globalThis.setTimeout(() => {
      showFade(fadeSide);
      fadeTimeoutRef.current = null;
    }, FADE_TRANSITION_MS);
  }, [clearPendingFade, fadeSide, renderedFadeSide, showFade]);

  return {
    renderedFadeSide,
    isFadeVisible,
  };
}

function useCarouselFade(showRightFade: boolean, emblaApi: EmblaApi) {
  const [fadeSide, setFadeSide] = useState<FadeSide | null>(null);

  const syncFadeSide = useCallback(() => {
    setFadeSide(getFadeSide(emblaApi, showRightFade));
  }, [emblaApi, showRightFade]);

  useEffect(() => {
    syncFadeSide();

    if (!emblaApi) return;

    emblaApi.on("init", syncFadeSide);
    emblaApi.on("reInit", syncFadeSide);
    emblaApi.on("select", syncFadeSide);
    emblaApi.on("scroll", syncFadeSide);

    return () => {
      emblaApi.off("init", syncFadeSide);
      emblaApi.off("reInit", syncFadeSide);
      emblaApi.off("select", syncFadeSide);
      emblaApi.off("scroll", syncFadeSide);
    };
  }, [emblaApi, syncFadeSide]);

  return useFadePresence(fadeSide);
}

function useCarouselControls(emblaApi: EmblaApi) {
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);
  const [visibleIndexes, setVisibleIndexes] = useState<number[]>([]);

  const syncControls = useCallback(() => {
    setCanScrollPrev(emblaApi?.canScrollPrev() ?? false);
    setCanScrollNext(emblaApi?.canScrollNext() ?? false);

    const viewportMetrics = emblaApi ? getViewportSlideMetrics(emblaApi) : null;
    if (!emblaApi || !viewportMetrics) {
      setVisibleIndexes([]);
      return;
    }

    const slideCount = emblaApi.slideNodes().length;
    const targetFirstIndex = Math.min(
      emblaApi.selectedScrollSnap(),
      Math.max(0, slideCount - viewportMetrics.visibleCount)
    );

    setVisibleIndexes(
      Array.from(
        { length: viewportMetrics.visibleCount },
        (_, position) => targetFirstIndex + position
      ).filter((index) => index < slideCount)
    );
  }, [emblaApi]);

  useEffect(() => {
    syncControls();

    if (!emblaApi) return;

    emblaApi.on("init", syncControls);
    emblaApi.on("reInit", syncControls);
    emblaApi.on("select", syncControls);
    emblaApi.on("scroll", syncControls);
    emblaApi.on("settle", syncControls);

    return () => {
      emblaApi.off("init", syncControls);
      emblaApi.off("reInit", syncControls);
      emblaApi.off("select", syncControls);
      emblaApi.off("scroll", syncControls);
      emblaApi.off("settle", syncControls);
    };
  }, [emblaApi, syncControls]);

  return {
    canScrollPrev,
    canScrollNext,
    visibleIndexes,
  };
}

function FocusCarouselCard({
  game,
  cardMode,
  cardVariant,
  isFocused = false,
  onClick,
  onContextMenu,
}: Readonly<{
  game: FocusCarouselGame;
  cardMode: FocusCarouselCardMode;
  cardVariant: "vertical" | "horizontal";
  isFocused?: boolean;
  onClick?: () => void;
  onContextMenu?: MouseEventHandler<HTMLElement>;
}>) {
  const libraryPresentation = useLibraryGameCardPresentation(game, "vertical");
  const primaryCoverImageUrl = getGameCoverImageSource(game);
  const fallbackCoverImageUrl = game.libraryImageUrl ?? game.iconUrl ?? null;
  const canFallbackCover =
    Boolean(fallbackCoverImageUrl) &&
    fallbackCoverImageUrl !== primaryCoverImageUrl;
  const [useFallbackCover, setUseFallbackCover] = useState(false);
  const coverImageUrl = useFallbackCover
    ? fallbackCoverImageUrl
    : primaryCoverImageUrl;

  useEffect(() => {
    setUseFallbackCover(false);
  }, [game.objectId, game.shop, primaryCoverImageUrl]);
  const isClassicsGame = game.shop === "launchbox";
  const libraryCoverSource = isClassicsGame
    ? libraryPresentation.activeImageSource
    : coverImageUrl;
  const displayLibraryCover = useFocusAnimatedCover(
    libraryCoverSource,
    isFocused
  );
  const defaultLibraryDominantColor = useDominantColor(
    cardMode === "library" ? (coverImageUrl ?? null) : null
  );

  if (cardMode === "library") {
    const coverMedia =
      isClassicsGame &&
      libraryPresentation.activeImageSource &&
      !libraryPresentation.isChosenCoverActive ? (
        <ClassicsVerticalCoverMedia
          imageUrl={displayLibraryCover}
          gameTitle={game.title}
          onImageError={libraryPresentation.handleCoverImageError}
        />
      ) : null;
    const coverOverlay =
      libraryPresentation.classicsPlatformLabel != null ? (
        <ClassicsCoverBadges
          platformLabel={libraryPresentation.classicsPlatformLabel}
          emulatorIcon={libraryPresentation.classicsEmulatorIcon}
        />
      ) : null;

    return (
      <VerticalGameCard
        className={
          isClassicsGame && cardVariant === "vertical"
            ? "library-focus-grid__card--classics"
            : undefined
        }
        coverImageUrl={displayLibraryCover}
        coverMedia={coverMedia}
        coverOverlay={coverOverlay}
        gameTitle={game.title}
        subtitle={libraryPresentation.playtimeLabel}
        progressLabel={libraryPresentation.achievementProgress.label}
        progressValue={libraryPresentation.achievementProgress.value}
        progressColor={
          (isClassicsGame
            ? libraryPresentation.dominantColor
            : defaultLibraryDominantColor) ?? undefined
        }
        onClick={onClick}
        onContextMenu={onContextMenu}
        onCoverImageError={
          isClassicsGame ? libraryPresentation.handleCoverImageError : undefined
        }
      />
    );
  }

  if (cardVariant === "horizontal") {
    return (
      <HorizontalStoreGameCard
        coverImageUrl={getGameLandscapeImageSource(game)}
        gameTitle={game.title}
        downloadSourceCount={game.downloadSources.length}
        onClick={onClick}
        onContextMenu={onContextMenu}
      />
    );
  }

  return (
    <VerticalStoreGameCard
      coverImageUrl={coverImageUrl}
      gameTitle={game.title}
      downloadSourceCount={game.downloadSources.length}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onCoverImageError={
        canFallbackCover ? () => setUseFallbackCover(true) : undefined
      }
    />
  );
}

function renderStaticSlide(
  game: FocusCarouselGame,
  cardMode: FocusCarouselCardMode,
  cardVariant: "vertical" | "horizontal"
) {
  return (
    <article key={getGameIdentityKey(game)} className="focus-carousel__slide">
      <FocusCarouselCard
        game={game}
        cardMode={cardMode}
        cardVariant={cardVariant}
      />
    </article>
  );
}

function FocusCarouselSlide({
  game,
  index,
  itemId,
  cardMode,
  cardVariant,
  navigationOverrides,
  onFocused,
  onActivate,
  onCardClick,
  onCarouselItemOpenContextMenu,
}: Readonly<FocusCarouselSlideProps>) {
  const isFocused = useNavigationIsFocused(itemId);

  useEffect(() => {
    if (!isFocused) return;

    onFocused();
  }, [isFocused, onFocused]);

  const handleCardContextMenu: MouseEventHandler<HTMLElement> = (event) => {
    if (!onCarouselItemOpenContextMenu) return;

    event.preventDefault();
    event.stopPropagation();
    onCarouselItemOpenContextMenu(
      game,
      { x: event.clientX, y: event.clientY },
      itemId
    );
  };

  return (
    <article className="focus-carousel__slide" data-slide-index={index}>
      <FocusItem
        id={itemId}
        actions={
          onActivate
            ? {
                primary: () => onActivate(game),
                press: {
                  y:
                    onCarouselItemOpenContextMenu != null
                      ? () => {
                          const element = document.getElementById(itemId);
                          const rect = element?.getBoundingClientRect();

                          if (rect) {
                            onCarouselItemOpenContextMenu(
                              game,
                              {
                                x: rect.left + rect.width / 2,
                                y: rect.top + rect.height / 2,
                              },
                              itemId
                            );
                          }
                        }
                      : undefined,
                },
              }
            : undefined
        }
        navigationOverrides={navigationOverrides}
      >
        <FocusCarouselCard
          cardMode={cardMode}
          cardVariant={cardVariant}
          game={game}
          isFocused={isFocused}
          onClick={onCardClick ? () => onCardClick(game) : undefined}
          onContextMenu={handleCardContextMenu}
        />
      </FocusItem>
    </article>
  );
}

export function FocusCarousel({
  title,
  headerMeta,
  games,
  regionId,
  getItemId,
  getItemNavigationOverrides,
  onItemActivate,
  controlsNavigation,
  onCarouselItemOpenContextMenu,
  showRightFade = false,
  cardMode = "store",
  cardVariant = "vertical",
}: Readonly<FocusCarouselProps>) {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: "start",
    containScroll: "trimSnaps",
    duration: 14,
  });
  const currentFocusId = useNavigationStore((state) => state.currentFocusId);
  const rememberedFocusId = useNavigationStore((state) =>
    regionId
      ? (state.debugSnapshot.lastFocusedByRegionId[regionId] ?? null)
      : null
  );
  const lastAlignedFocusIdRef = useRef<string | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressPointerClickRef = useRef(false);
  const { handleFocused: handleSlideFocused, reset: resetFocusScroll } =
    useThresholdFocusScroll(emblaApi);
  const firstItemId = games[0] ? getItemId?.(games[0]) : undefined;
  const shouldBlockLeftExit = useLeftExitLock(firstItemId);
  const { renderedFadeSide, isFadeVisible } = useCarouselFade(
    showRightFade,
    emblaApi
  );
  const { canScrollPrev, canScrollNext, visibleIndexes } =
    useCarouselControls(emblaApi);
  const focusIndexes = getDirectionBiasedFocusIndexes(visibleIndexes);
  const previousFocusGame =
    focusIndexes.previous == null ? undefined : games[focusIndexes.previous];
  const nextFocusGame =
    focusIndexes.next == null ? undefined : games[focusIndexes.next];
  const previousFocusItemId = previousFocusGame
    ? getItemId?.(previousFocusGame)
    : undefined;
  const nextFocusItemId = nextFocusGame
    ? getItemId?.(nextFocusGame)
    : undefined;
  const previousControlNavigationOverrides = mergeNavigationOverrides(
    controlsNavigation?.navigationOverrides ?? {},
    previousFocusItemId
      ? { down: getOptionalItemFocusTarget(previousFocusItemId) }
      : undefined
  );
  const nextControlNavigationOverrides = mergeNavigationOverrides(
    controlsNavigation?.navigationOverrides ?? {},
    nextFocusItemId
      ? { down: getOptionalItemFocusTarget(nextFocusItemId) }
      : undefined
  );

  useEffect(() => {
    if (
      currentFocusId === controlsNavigation?.previousId ||
      currentFocusId === controlsNavigation?.nextId
    ) {
      resetFocusScroll();
    }
  }, [controlsNavigation, currentFocusId, resetFocusScroll]);

  useEffect(() => {
    const getFocusedIndex = (focusId: string | null) => {
      if (!focusId || !getItemId) return -1;

      return games.findIndex((game) => getItemId(game) === focusId);
    };

    const currentFocusedIndex = getFocusedIndex(currentFocusId);
    const isCarouselControlFocused =
      currentFocusId === controlsNavigation?.previousId ||
      currentFocusId === controlsNavigation?.nextId;
    const targetFocusId = currentFocusedIndex === -1 ? rememberedFocusId : null;
    const focusedIndex = getFocusedIndex(targetFocusId);

    if (currentFocusedIndex !== -1) {
      lastAlignedFocusIdRef.current = null;
      return;
    }

    if (isCarouselControlFocused) {
      lastAlignedFocusIdRef.current = null;
      return;
    }

    if (!emblaApi || focusedIndex === -1 || !targetFocusId) return;
    if (lastAlignedFocusIdRef.current === targetFocusId) return;

    const animationFrameId = globalThis.requestAnimationFrame(() => {
      const viewportMetrics = getViewportSlideMetrics(emblaApi);

      if (!viewportMetrics) return;

      const selectedPosition = Math.floor(viewportMetrics.visibleCount / 2) + 1;
      const maxStartIndex = Math.max(
        0,
        games.length - viewportMetrics.visibleCount
      );
      const targetStartIndex = Math.max(
        0,
        Math.min(focusedIndex - (selectedPosition - 1), maxStartIndex)
      );

      lastAlignedFocusIdRef.current = targetFocusId;

      if (viewportMetrics.firstVisibleIndex !== targetStartIndex) {
        emblaApi.scrollTo(targetStartIndex, true);
      }
    });

    return () => {
      globalThis.cancelAnimationFrame(animationFrameId);
    };
  }, [
    controlsNavigation,
    currentFocusId,
    emblaApi,
    games,
    getItemId,
    rememberedFocusId,
  ]);

  useEffect(() => {
    lastAlignedFocusIdRef.current = null;
  }, [games, rememberedFocusId]);

  const handleViewportPointerDownCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;

      pointerStartRef.current = { x: event.clientX, y: event.clientY };
      suppressPointerClickRef.current = false;
    },
    []
  );

  const handleViewportPointerMoveCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const pointerStart = pointerStartRef.current;

      if (!pointerStart) return;

      const deltaX = event.clientX - pointerStart.x;
      const deltaY = event.clientY - pointerStart.y;
      const movedEnoughHorizontally =
        Math.abs(deltaX) > CLICK_DRAG_THRESHOLD_PX &&
        Math.abs(deltaX) > Math.abs(deltaY);

      if (movedEnoughHorizontally) {
        suppressPointerClickRef.current = true;
      }
    },
    []
  );

  const handleViewportPointerEndCapture = useCallback(() => {
    pointerStartRef.current = null;
  }, []);

  const handleCardClick = useCallback(
    (game: FocusCarouselGame) => {
      if (suppressPointerClickRef.current) {
        suppressPointerClickRef.current = false;
        return;
      }

      onItemActivate?.(game);
    },
    [onItemActivate]
  );

  const handleControlMouseDown: MouseEventHandler<HTMLButtonElement> =
    useCallback((event) => {
      event.preventDefault();
    }, []);

  if (games.length === 0) return null;

  return (
    <section
      className="focus-carousel"
      aria-label={title}
      data-card-variant={cardVariant}
    >
      {title ? (
        <div className="focus-carousel__header">
          <h2 className="focus-carousel__title">{title}</h2>
          {headerMeta != null ? (
            <div className="focus-carousel__header-meta">{headerMeta}</div>
          ) : controlsNavigation ? (
            <HorizontalFocusGroup
              regionId={controlsNavigation.regionId}
              asChild
            >
              <div className="focus-carousel__header-actions">
                <FocusItem
                  id={controlsNavigation.previousId}
                  navigationOverrides={mergeNavigationOverrides(
                    previousControlNavigationOverrides ?? {},
                    {
                      left: { type: "block" },
                      right: getOptionalItemFocusTarget(
                        controlsNavigation.nextId
                      ),
                    }
                  )}
                  asChild
                >
                  <button
                    type="button"
                    className="focus-carousel__header-button"
                    aria-label="Previous"
                    aria-disabled={!canScrollPrev}
                    onMouseDown={handleControlMouseDown}
                    onClick={() => {
                      if (canScrollPrev) emblaApi?.scrollPrev();
                    }}
                  >
                    <CaretLeftIcon size={20} />
                  </button>
                </FocusItem>
                <FocusItem
                  id={controlsNavigation.nextId}
                  navigationOverrides={mergeNavigationOverrides(
                    nextControlNavigationOverrides ?? {},
                    {
                      left: getOptionalItemFocusTarget(
                        controlsNavigation.previousId
                      ),
                      right: { type: "block" },
                    }
                  )}
                  asChild
                >
                  <button
                    type="button"
                    className="focus-carousel__header-button"
                    aria-label="Next"
                    aria-disabled={!canScrollNext}
                    onMouseDown={handleControlMouseDown}
                    onClick={() => {
                      if (canScrollNext) emblaApi?.scrollNext();
                    }}
                  >
                    <CaretRightIcon size={20} />
                  </button>
                </FocusItem>
              </div>
            </HorizontalFocusGroup>
          ) : (
            <div className="focus-carousel__header-actions">
              <button
                type="button"
                className="focus-carousel__header-button"
                aria-label="Previous"
                disabled={!canScrollPrev}
                onClick={() => emblaApi?.scrollPrev()}
              >
                <CaretLeftIcon size={20} />
              </button>
              <button
                type="button"
                className="focus-carousel__header-button"
                aria-label="Next"
                disabled={!canScrollNext}
                onClick={() => emblaApi?.scrollNext()}
              >
                <CaretRightIcon size={20} />
              </button>
            </div>
          )}
        </div>
      ) : null}

      <div
        className="focus-carousel__viewport-wrapper"
        data-fade-side={renderedFadeSide ?? undefined}
        data-fade-visible={isFadeVisible || undefined}
      >
        <div
          className="focus-carousel__viewport"
          ref={emblaRef}
          onPointerDownCapture={handleViewportPointerDownCapture}
          onPointerMoveCapture={handleViewportPointerMoveCapture}
          onPointerUpCapture={handleViewportPointerEndCapture}
          onPointerCancelCapture={handleViewportPointerEndCapture}
        >
          <HorizontalFocusGroup
            className="focus-carousel__container"
            regionId={regionId}
            asChild
          >
            <div>
              {games.map((game, index) => {
                const itemId = getItemId?.(game);

                if (!itemId) {
                  return renderStaticSlide(game, cardMode, cardVariant);
                }

                const navigationOverrides = mergeNavigationOverrides(
                  getDefaultItemNavigationOverrides(index, games, getItemId),
                  mergeNavigationOverrides(
                    getItemNavigationOverrides?.(game, index, games) ?? {},
                    shouldBlockLeftExit && index === 0
                      ? {
                          left: {
                            type: "block",
                          },
                        }
                      : undefined
                  )
                );

                return (
                  <FocusCarouselSlide
                    key={itemId}
                    game={game}
                    index={index}
                    itemId={itemId}
                    cardMode={cardMode}
                    cardVariant={cardVariant}
                    navigationOverrides={navigationOverrides}
                    onCarouselItemOpenContextMenu={
                      onCarouselItemOpenContextMenu
                    }
                    onFocused={() => handleSlideFocused(index)}
                    onActivate={onItemActivate}
                    onCardClick={handleCardClick}
                  />
                );
              })}
            </div>
          </HorizontalFocusGroup>
        </div>
      </div>
    </section>
  );
}
