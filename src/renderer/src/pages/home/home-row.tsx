import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  SyncIcon,
} from "@primer/octicons-react";
import Skeleton from "react-loading-skeleton";
import type { HomeRowGame } from "./home-game-card";
import { HomeGameCard } from "./home-game-card";
import { HomeGameCardVertical } from "./home-game-card-vertical";
import { HomeRecentlyPlayedCard } from "./home-recently-played-card";
import { useHomeHydration } from "./home-hydration-context";
import { useHomeScrollState } from "./home-scroll-state-context";
import { useAppSelector } from "@renderer/hooks";
import "./home-row.scss";

const CARD_SIZES = {
  horizontal: { width: 507, gap: 12, height: 238 },
  vertical: { width: 286, gap: 12, height: 381 },
  "recently-played": { width: 580, gap: 16, height: 272 },
};
const CARDS_PER_CLICK = 2;
const INITIAL_VISIBLE_CARDS = 6;
const CARD_BATCH_SIZE = 4;

const ARROW_EDGE_ZONE_PX = 220;

const MOMENTUM_FRICTION = 0.94;
const MOMENTUM_MIN_VELOCITY = 0.02;
const MOMENTUM_MAX_VELOCITY = 4;
const MOMENTUM_STALE_MS = 80;

type CardStyle = "horizontal" | "vertical" | "recently-played";

interface HomeRowProps {
  title: React.ReactNode;
  games: HomeRowGame[];
  isLoading?: boolean;
  onSeeAll?: () => void;
  prefixNode?: React.ReactNode;
  cardStyle?: CardStyle;
  animationDelay?: number;
  scrollResetSignal?: number;
  titleAffordance?: "navigate" | "refresh";
  skipEntrance?: boolean;
}

function HomeRowImpl({
  title,
  games,
  isLoading = false,
  onSeeAll,
  prefixNode,
  cardStyle = "horizontal",
  animationDelay = 0,
  scrollResetSignal,
  titleAffordance = "navigate",
  skipEntrance = false,
}: HomeRowProps) {
  const isHydrating = useHomeHydration();
  const effectiveIsLoading = isLoading || isHydrating;

  const disableSlideAnimations = useAppSelector(
    (state) => state.userPreferences.value?.disableHomeSlideAnimations ?? false
  );

  const sectionRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isDragging = useRef(false);
  const hasDragged = useRef(false);
  const startX = useRef(0);
  const savedLeft = useRef(0);

  const velocityRef = useRef(0);
  const lastDragXRef = useRef(0);
  const lastDragTimeRef = useRef(0);
  const momentumRafRef = useRef<number | null>(null);

  const [atStart, setAtStart] = useState(true);
  const [arrowHover, setArrowHover] = useState<"left" | "right" | null>(null);
  const arrowHoverRef = useRef<"left" | "right" | null>(null);

  const chevronRef = useRef<HTMLSpanElement>(null);
  const handleTitleClick = useCallback(() => {
    if (titleAffordance === "refresh" && chevronRef.current) {
      const el = chevronRef.current;
      el.classList.remove("home-row__title-chevron--spinning");
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      void el.offsetWidth;
      el.classList.add("home-row__title-chevron--spinning");
    }
    onSeeAll?.();
  }, [titleAffordance, onSeeAll]);

  const handleChevronAnimationEnd = useCallback(() => {
    chevronRef.current?.classList.remove("home-row__title-chevron--spinning");
  }, []);

  const [isVisible, setIsVisible] = useState(skipEntrance);
  useEffect(() => {
    if (skipEntrance) return;
    const id = setTimeout(() => setIsVisible(true), animationDelay);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [rowInView, setRowInView] = useState(false);

  const savedScrollLeftRef = useRef(0);

  useLayoutEffect(() => {
    const target = sectionRef.current;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const margin = 2400;
    const inViewport =
      rect.bottom > -margin && rect.top < window.innerHeight + margin;
    if (inViewport) setRowInView(true);
    /* Run once on mount only. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unmountTimerRef = useRef<number | null>(null);

  const { isScrollingRef, subscribe } = useHomeScrollState();
  const pendingRowInViewRef = useRef<boolean | null>(null);

  useEffect(() => {
    const target = sectionRef.current;
    if (!target) return;
    const clearTimer = () => {
      if (unmountTimerRef.current !== null) {
        window.clearTimeout(unmountTimerRef.current);
        unmountTimerRef.current = null;
      }
    };
    const applyInView = (next: boolean) => {
      if (next) {
        pendingRowInViewRef.current = null;
        setRowInView(true);
        return;
      }
      if (isScrollingRef.current) {
        pendingRowInViewRef.current = false;
        return;
      }
      pendingRowInViewRef.current = null;
      setRowInView(false);
    };
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          clearTimer();
          applyInView(true);
        } else {
          if (isDragging.current) return;
          if (scrollRef.current) {
            savedScrollLeftRef.current = scrollRef.current.scrollLeft;
          }
          clearTimer();
          unmountTimerRef.current = window.setTimeout(() => {
            unmountTimerRef.current = null;
            applyInView(false);
          }, 300);
        }
      },
      { rootMargin: "2400px 0px" }
    );
    obs.observe(target);
    const unsubscribe = subscribe(() => {
      const pending = pendingRowInViewRef.current;
      if (pending === null) return;
      pendingRowInViewRef.current = null;
      setRowInView(pending);
    });
    return () => {
      obs.disconnect();
      clearTimer();
      unsubscribe();
    };
  }, [isScrollingRef, subscribe]);

  useLayoutEffect(() => {
    if (!rowInView || !scrollRef.current) return;
    if (savedScrollLeftRef.current > 0) {
      scrollRef.current.scrollLeft = savedScrollLeftRef.current;
    }
  }, [rowInView]);

  const [visibleCardCount, setVisibleCardCount] = useState(
    INITIAL_VISIBLE_CARDS
  );

  const { width: cardWidth, gap: cardGap } = CARD_SIZES[cardStyle];
  const scrollStep = CARDS_PER_CLICK * (cardWidth + cardGap);

  const updateArrows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 0);

    if (visibleCardCount < games.length) {
      const renderedWidth = visibleCardCount * (cardWidth + cardGap);
      const visibleRight = el.scrollLeft + el.clientWidth;
      if (visibleRight > renderedWidth - 400) {
        setVisibleCardCount((c) => Math.min(c + CARD_BATCH_SIZE, games.length));
      }
    }
  }, [cardGap, cardWidth, games.length, visibleCardCount]);

  const cancelMomentum = () => {
    if (momentumRafRef.current !== null) {
      cancelAnimationFrame(momentumRafRef.current);
      momentumRafRef.current = null;
    }
  };

  const startMomentum = () => {
    cancelMomentum();
    if (disableSlideAnimations) return;
    if (performance.now() - lastDragTimeRef.current > MOMENTUM_STALE_MS) return;
    let velocity = Math.max(
      -MOMENTUM_MAX_VELOCITY,
      Math.min(MOMENTUM_MAX_VELOCITY, velocityRef.current)
    );
    velocityRef.current = 0;
    if (Math.abs(velocity) < MOMENTUM_MIN_VELOCITY) return;

    let prev = performance.now();
    const step = (now: number) => {
      const el = scrollRef.current;
      if (!el) {
        momentumRafRef.current = null;
        return;
      }
      const dt = now - prev;
      prev = now;
      el.scrollLeft += velocity * dt;
      velocity *= Math.pow(MOMENTUM_FRICTION, dt / 16.67);
      const atEdge =
        el.scrollLeft <= 0 ||
        el.scrollLeft >= el.scrollWidth - el.clientWidth - 1;
      if (Math.abs(velocity) < MOMENTUM_MIN_VELOCITY || atEdge) {
        momentumRafRef.current = null;
        updateArrows();
        return;
      }
      momentumRafRef.current = requestAnimationFrame(step);
    };
    momentumRafRef.current = requestAnimationFrame(step);
  };

  const onScrollMouseDown = (e: React.MouseEvent) => {
    if (!scrollRef.current) return;
    cancelMomentum();
    velocityRef.current = 0;
    lastDragXRef.current = e.pageX;
    lastDragTimeRef.current = performance.now();
    isDragging.current = true;
    hasDragged.current = false;
    startX.current = e.pageX;
    savedLeft.current = scrollRef.current.scrollLeft;
    /* DON'T add the --dragging class here. The class enables
       `pointer-events: none > *` which blocks the click event from
       registering on the card a plain tap would otherwise hit. Plain
       taps (mousedown → mouseup without movement) need to land their
       click; only actual drags (cursor moved past the threshold)
       should suppress hover/pointer-events. The class is added on
       the FIRST real drag move in onScrollMouseMove below. */
  };

  const onScrollMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current || !scrollRef.current) return;
    const diff = e.pageX - startX.current;
    if (Math.abs(diff) > 5) {
      if (!hasDragged.current) {
        scrollRef.current.classList.add("home-row__scroll--dragging");
      }
      hasDragged.current = true;
    }
    scrollRef.current.scrollLeft = savedLeft.current - diff;

    const now = performance.now();
    const dt = now - lastDragTimeRef.current;
    if (dt > 0) {
      const instant = -(e.pageX - lastDragXRef.current) / dt;
      velocityRef.current = velocityRef.current * 0.7 + instant * 0.3;
    }
    lastDragXRef.current = e.pageX;
    lastDragTimeRef.current = now;

    if (arrowHoverRef.current !== null) {
      arrowHoverRef.current = null;
      setArrowHover(null);
    }
  };

  const onViewportMouseMove = (e: React.MouseEvent) => {
    if (isDragging.current) return;
    const vp = viewportRef.current;
    if (!vp) return;
    const rect = vp.getBoundingClientRect();
    if (rect.width === 0) return;
    const relX = e.clientX - rect.left;
    let next: "left" | "right" | null;
    if (relX < ARROW_EDGE_ZONE_PX) {
      next = "left";
    } else if (relX > rect.width - ARROW_EDGE_ZONE_PX) {
      next = "right";
    } else {
      next = null;
    }
    if (next !== arrowHoverRef.current) {
      arrowHoverRef.current = next;
      setArrowHover(next);
    }
  };

  const stopDrag = () => {
    const wasDragging = isDragging.current;
    isDragging.current = false;
    scrollRef.current?.classList.remove("home-row__scroll--dragging");
    if (wasDragging && hasDragged.current) startMomentum();
    updateArrows();
  };

  const onViewportMouseLeave = () => {
    if (arrowHoverRef.current !== null) {
      arrowHoverRef.current = null;
      setArrowHover(null);
    }
    stopDrag();
  };

  const handleClickCapture = (e: React.MouseEvent) => {
    if (hasDragged.current) {
      e.stopPropagation();
      hasDragged.current = false;
    }
  };

  const lastScrollResetRef = useRef<number | undefined>(scrollResetSignal);
  const scrollResetCleanupRef = useRef<number | null>(null);
  useEffect(() => {
    if (scrollResetSignal === undefined) return;
    if (lastScrollResetRef.current === scrollResetSignal) return;
    lastScrollResetRef.current = scrollResetSignal;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: 0, behavior: "smooth" });
    setAtStart(true);
    if (scrollResetCleanupRef.current !== null) {
      window.clearTimeout(scrollResetCleanupRef.current);
    }
    scrollResetCleanupRef.current = window.setTimeout(() => {
      scrollResetCleanupRef.current = null;
      setVisibleCardCount(INITIAL_VISIBLE_CARDS);
    }, 420);
  }, [scrollResetSignal]);
  useEffect(
    () => () => {
      if (scrollResetCleanupRef.current !== null) {
        window.clearTimeout(scrollResetCleanupRef.current);
      }
      if (momentumRafRef.current !== null) {
        cancelAnimationFrame(momentumRafRef.current);
      }
    },
    []
  );

  const scrollRight = (e: React.MouseEvent) => {
    e.stopPropagation();
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollLeft >= el.scrollWidth - el.clientWidth - 1) {
      el.scrollTo({ left: 0, behavior: "smooth" });
    } else {
      el.scrollBy({ left: scrollStep, behavior: "smooth" });
    }
    setTimeout(updateArrows, 350);
  };

  const scrollLeftFn = (e: React.MouseEvent) => {
    e.stopPropagation();
    scrollRef.current?.scrollBy({ left: -scrollStep, behavior: "smooth" });
    setTimeout(updateArrows, 350);
  };

  if (!effectiveIsLoading && games.length === 0 && prefixNode == null)
    return null;

  const showCards = rowInView && !effectiveIsLoading;
  const skeletonClass =
    cardStyle === "vertical"
      ? "home-row__skeleton--vertical"
      : cardStyle === "recently-played"
        ? "home-row__skeleton--recently-played"
        : "home-row__skeleton";

  const visibleGames = games.slice(0, visibleCardCount);

  const AffordanceIcon =
    titleAffordance === "refresh" ? SyncIcon : ChevronRightIcon;
  const titleNode = onSeeAll ? (
    <button
      type="button"
      className={`home-row__title home-row__title--clickable${
        titleAffordance === "refresh" ? " home-row__title--refresh" : ""
      }`}
      onClick={handleTitleClick}
    >
      <span className="home-row__title-text">{title}</span>
      <span
        ref={chevronRef}
        className={`home-row__title-chevron${
          titleAffordance === "refresh"
            ? " home-row__title-chevron--refresh"
            : ""
        }`}
        aria-hidden="true"
        onAnimationEnd={handleChevronAnimationEnd}
      >
        <AffordanceIcon size={16} />
      </span>
    </button>
  ) : (
    <h2 className="home-row__title">{title}</h2>
  );

  return (
    <section
      ref={sectionRef}
      className={`home-row home-row--${cardStyle}${
        isVisible ? " home-row--visible" : ""
      }${skipEntrance ? " home-row--instant" : ""}`}
      style={{ animationDelay: `${animationDelay}ms` } as React.CSSProperties}
    >
      <div className="home-row__header">{titleNode}</div>

      {/* Viewport is always mounted — skeletons while `rowInView` is
          false, real game cards after. Keeps the user from seeing
          empty space during fast vertical scrolls regardless of how
          far ahead the IntersectionObserver fires. */}
      {/* The viewport + scroll containers wrap the row's actual
          interactive elements (cards = <button>, overlay arrows =
          <button>). They themselves are non-semantic surfaces that
          carry mouse handlers only for drag-to-scroll and
          hover-arrow tracking — there's no equivalent native
          interactive element for a "drag-to-scroll surface". A
          screen-reader user navigates the inner buttons directly,
          so adding a misleading role here would confuse AT. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        ref={viewportRef}
        className="home-row__viewport"
        onMouseMove={onViewportMouseMove}
        onMouseLeave={onViewportMouseLeave}
      >
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div
          ref={scrollRef}
          className="home-row__scroll"
          onMouseDown={onScrollMouseDown}
          onMouseMove={onScrollMouseMove}
          onMouseUp={stopDrag}
          onClickCapture={handleClickCapture}
          onScroll={updateArrows}
        >
          {prefixNode}
          {showCards
            ? visibleGames.map((game) => {
                if (cardStyle === "vertical") {
                  return (
                    <HomeGameCardVertical
                      key={`${game.shop}-${game.objectId}`}
                      game={game}
                    />
                  );
                }
                if (cardStyle === "recently-played") {
                  return (
                    <HomeRecentlyPlayedCard
                      key={`${game.shop}-${game.objectId}`}
                      game={game}
                    />
                  );
                }
                return (
                  <HomeGameCard
                    key={`${game.shop}-${game.objectId}`}
                    game={game}
                  />
                );
              })
            : Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className={skeletonClass} />
              ))}
        </div>

        {/* Overlay arrows — absolutely positioned over the
              viewport (NOT the scroll container) so the layout is
              stable and they stay clickable from anywhere within the
              row's bounds. Faded in only while the cursor sits in
              the matching edge zone of the viewport. The left arrow
              stays hidden when scroll is already at the start so the
              user never sees a useless control. */}
        <button
          type="button"
          className={`home-row__overlay-arrow home-row__overlay-arrow--left${
            arrowHover === "left" && !atStart
              ? " home-row__overlay-arrow--visible"
              : ""
          }`}
          onClick={scrollLeftFn}
          aria-label="Scroll left"
          tabIndex={-1}
        >
          <ChevronLeftIcon size={20} />
        </button>
        <button
          type="button"
          className={`home-row__overlay-arrow home-row__overlay-arrow--right${
            arrowHover === "right" ? " home-row__overlay-arrow--visible" : ""
          }`}
          onClick={scrollRight}
          aria-label="Scroll right"
          tabIndex={-1}
        >
          <ChevronRightIcon size={20} />
        </button>
      </div>
    </section>
  );
}

export const HomeRow = memo(HomeRowImpl);
