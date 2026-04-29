import type { ShopAssets } from "@types";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import useEmblaCarousel from "embla-carousel-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useGamepad } from "../../../hooks";
import type { FocusOverrides } from "../../../services";
import { useNavigationIsFocused, useNavigationStore } from "../../../stores";
import { GamepadAxisType, GamepadButtonType } from "../../../types";
import { FocusItem } from "../focus-item";
import { HorizontalFocusGroup } from "../horizontal-focus-group";
import { HorizontalStoreGameCard } from "../horizontal-store-game-card";
import { VerticalStoreGameCard } from "../vertical-store-game-card";
import {
  getGameCoverImageSource,
  getGameIdentityKey,
  getGameLandscapeImageSource,
  getOptionalItemFocusTarget,
} from "../../../helpers";

import "./styles.scss";

const FADE_TRANSITION_MS = 120;
const PARTIAL_VISIBLE_SLIDE_RATIO = 0.5;
const SLIDE_MEASUREMENT_EPSILON_PX = 1;
const LEFT_INPUT_HELD_THRESHOLD = -0.5;

type FadeSide = "left" | "right";
type EmblaApi = ReturnType<typeof useEmblaCarousel>[1];
type ResolvedEmblaApi = NonNullable<EmblaApi>;

interface FocusCarouselProps {
  title?: string;
  games: ShopAssets[];
  regionId?: string;
  showRightFade?: boolean;
  cardVariant?: "vertical" | "horizontal";
  getItemId?: (game: ShopAssets) => string;
  onItemActivate?: (game: ShopAssets) => void;
  getItemNavigationOverrides?: (
    game: ShopAssets,
    index: number,
    games: ShopAssets[]
  ) => FocusOverrides | undefined;
}

interface FocusCarouselSlideProps {
  game: ShopAssets;
  index: number;
  itemId: string;
  cardVariant: "vertical" | "horizontal";
  navigationOverrides?: FocusOverrides;
  onFocused: () => void;
  onActivate?: (game: ShopAssets) => void;
}

function getDefaultItemNavigationOverrides(
  index: number,
  games: ShopAssets[],
  getItemId?: (game: ShopAssets) => string
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

  const isOutOfBounds =
    visiblePositionOneBased < 1 || visiblePositionOneBased > visibleCount;

  if (isOutOfBounds) return;

  const selectedPosition = Math.floor(visibleCount / 2) + 1;
  const isMovingRight = nextFocusedIndex > previousFocusedIndex;
  const didScroll = isMovingRight
    ? visiblePositionOneBased > selectedPosition && emblaApi.canScrollNext()
    : visiblePositionOneBased < selectedPosition && emblaApi.canScrollPrev();

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

  return useCallback(
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

  const syncControls = useCallback(() => {
    setCanScrollPrev(emblaApi?.canScrollPrev() ?? false);
    setCanScrollNext(emblaApi?.canScrollNext() ?? false);
  }, [emblaApi]);

  useEffect(() => {
    syncControls();

    if (!emblaApi) return;

    emblaApi.on("init", syncControls);
    emblaApi.on("reInit", syncControls);
    emblaApi.on("select", syncControls);
    emblaApi.on("scroll", syncControls);

    return () => {
      emblaApi.off("init", syncControls);
      emblaApi.off("reInit", syncControls);
      emblaApi.off("select", syncControls);
      emblaApi.off("scroll", syncControls);
    };
  }, [emblaApi, syncControls]);

  return {
    canScrollPrev,
    canScrollNext,
  };
}

function FocusCarouselCard({
  game,
  cardVariant,
}: Readonly<{ game: ShopAssets; cardVariant: "vertical" | "horizontal" }>) {
  if (cardVariant === "horizontal") {
    return (
      <HorizontalStoreGameCard
        coverImageUrl={getGameLandscapeImageSource(game)}
        gameTitle={game.title}
        downloadSourceCount={game.downloadSources.length}
      />
    );
  }

  return (
    <VerticalStoreGameCard
      coverImageUrl={getGameCoverImageSource(game)}
      gameTitle={game.title}
      downloadSourceCount={game.downloadSources.length}
    />
  );
}

function renderStaticSlide(
  game: ShopAssets,
  cardVariant: "vertical" | "horizontal"
) {
  return (
    <article key={getGameIdentityKey(game)} className="focus-carousel__slide">
      <FocusCarouselCard game={game} cardVariant={cardVariant} />
    </article>
  );
}

function FocusCarouselSlide({
  game,
  index,
  itemId,
  cardVariant,
  navigationOverrides,
  onFocused,
  onActivate,
}: Readonly<FocusCarouselSlideProps>) {
  const isFocused = useNavigationIsFocused(itemId);

  useEffect(() => {
    if (!isFocused) return;

    onFocused();
  }, [isFocused, onFocused]);

  return (
    <article className="focus-carousel__slide" data-slide-index={index}>
      <FocusItem
        id={itemId}
        actions={
          onActivate
            ? {
                primary: () => onActivate(game),
                secondary: "off",
              }
            : undefined
        }
        navigationOverrides={navigationOverrides}
      >
        <FocusCarouselCard game={game} cardVariant={cardVariant} />
      </FocusItem>
    </article>
  );
}

export function FocusCarousel({
  title,
  games,
  regionId,
  getItemId,
  getItemNavigationOverrides,
  onItemActivate,
  showRightFade = false,
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
  const handleSlideFocused = useThresholdFocusScroll(emblaApi);
  const firstItemId = games[0] ? getItemId?.(games[0]) : undefined;
  const shouldBlockLeftExit = useLeftExitLock(firstItemId);
  const { renderedFadeSide, isFadeVisible } = useCarouselFade(
    showRightFade,
    emblaApi
  );
  const { canScrollPrev, canScrollNext } = useCarouselControls(emblaApi);

  useEffect(() => {
    const getFocusedIndex = (focusId: string | null) => {
      if (!focusId || !getItemId) return -1;

      return games.findIndex((game) => getItemId(game) === focusId);
    };

    const currentFocusedIndex = getFocusedIndex(currentFocusId);
    const targetFocusId =
      currentFocusedIndex !== -1 ? currentFocusId : rememberedFocusId;
    const focusedIndex = getFocusedIndex(targetFocusId);

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
  }, [currentFocusId, emblaApi, games, getItemId, rememberedFocusId]);

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
        </div>
      ) : null}

      <div
        className="focus-carousel__viewport-wrapper"
        data-fade-side={renderedFadeSide ?? undefined}
        data-fade-visible={isFadeVisible || undefined}
      >
        <div className="focus-carousel__viewport" ref={emblaRef}>
          <HorizontalFocusGroup
            className="focus-carousel__container"
            regionId={regionId}
            asChild
          >
            <div>
              {games.map((game, index) => {
                const itemId = getItemId?.(game);

                if (!itemId) return renderStaticSlide(game, cardVariant);

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
                    cardVariant={cardVariant}
                    navigationOverrides={navigationOverrides}
                    onFocused={() => handleSlideFocused(index)}
                    onActivate={onItemActivate}
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
