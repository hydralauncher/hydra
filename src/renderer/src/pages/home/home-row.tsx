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
import "./home-row.scss";

/* Keep in sync with CSS card widths */
const CARD_SIZES = {
  /* Horizontal scaled 1.3× from its original 390×183 — image aspect
     is preserved (~2.13) so headers still fill the card with no
     letterbox. Keep this in lockstep with home-game-card.scss. */
  horizontal: { width: 507, gap: 12, height: 238 },
  /* Vertical scaled 1.3× from its original 220×293 (aspect ~0.751
     preserved). Keep in lockstep with home-game-card-vertical.scss. */
  vertical: { width: 286, gap: 12, height: 381 },
  /* Library-style horizontal card used by the Recently Played row.
     Slightly bigger than the standard horizontal (580×272 vs 507×238)
     so the row visually anchors the user's "your stuff" presence on
     Home. Keep in lockstep with home-recently-played-card.scss. */
  "recently-played": { width: 580, gap: 16, height: 272 },
};
const CARDS_PER_CLICK = 2;
/* How many cards to render up front before the user scrolls right. */
const INITIAL_VISIBLE_CARDS = 6;
/* How many additional cards to render each time the user nears the right
   edge of the currently-rendered set. */
const CARD_BATCH_SIZE = 4;

/* Edge-zone width in pixels. The arrows only appear when the cursor
   is within this distance of the carousel's left/right edge — the
   middle of the row stays clean. The previous 50/50 split made the
   arrows feel intrusive (hovering ANY card surfaced an arrow), so
   the user explicitly asked for an edge-only trigger.

   Comfortably wider than the arrow button itself (36px @ left: 8px,
   so the button spans 8..44px). With a 140px zone, moving the cursor
   from the surrounding cards onto the visible arrow stays inside
   the same zone — no flicker. The center region (140px..width-140)
   shows neither arrow. */
const ARROW_EDGE_ZONE_PX = 220;

type CardStyle = "horizontal" | "vertical" | "recently-played";

interface HomeRowProps {
  /* Accepts a plain string (existing localized row titles) OR a rich
     React node so callers can render an icon + dynamic copy when
     personalizing a row to one of the user's played games. */
  title: React.ReactNode;
  games: HomeRowGame[];
  isLoading?: boolean;
  /** Clicking the row title fires this handler — replaces the
   *  former See All button. When undefined, the title renders as a
   *  static heading. The "Picks for you" row uses this to trigger
   *  its reshuffle from the title itself. */
  onSeeAll?: () => void;
  prefixNode?: React.ReactNode;
  cardStyle?: CardStyle;
  /** Milliseconds to wait after mount before playing the entrance animation */
  animationDelay?: number;
  /** Whenever this number changes, the row smoothly scrolls back
   *  to the first card. Used by Picks for you so a reshuffle always
   *  lands the user on slot 0 of the freshly-rolled picks instead
   *  of leaving them mid-row from the previous shuffle. */
  scrollResetSignal?: number;
  /** Affordance icon next to the title when it's clickable. Default
   *  "navigate" → ChevronRightIcon (looks like a link).
   *  "refresh" → SyncIcon (used by Picks for you so the title reads
   *  as a re-roll button rather than a link to elsewhere). */
  titleAffordance?: "navigate" | "refresh";
  /** When true, the row skips its opacity:0 → fade-in entrance entirely
   *  and renders visible from the very first paint. Home passes this
   *  on every non-first mount so returning to the page (e.g. Library
   *  → Home) is instant instead of waiting through the 30-row × 60ms
   *  cascade (≈2s of empty viewport). */
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
  /* Home-wide hydration flag. While true, every row forces its
     skeleton state regardless of caller wiring so the layout
     doesn't collapse on remount. */
  const isHydrating = useHomeHydration();
  const effectiveIsLoading = isLoading || isHydrating;

  const sectionRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  /* Drag */
  const isDragging = useRef(false);
  const hasDragged = useRef(false);
  const startX = useRef(0);
  const savedLeft = useRef(0);

  /* Arrow state — `atStart` gates the left-arrow disabled look,
     `arrowHover` tracks which overlay arrow should currently fade
     in. null = neither (cursor is in the center band). Mirrored
     into a ref so the mousemove handler can dedupe writes without
     stale-closure read of the React state. */
  const [atStart, setAtStart] = useState(true);
  const [arrowHover, setArrowHover] = useState<"left" | "right" | null>(null);
  const arrowHoverRef = useRef<"left" | "right" | null>(null);

  /* Refresh-chevron spin state — one-shot animation per click so it
     completes a full 360° even when the user releases the mouse
     immediately. Previous CSS-only :active approach reset the angle
     mid-rotation on mouseup. Now JS toggles `--spinning` on click;
     the SCSS keyframe runs to completion; the `animationend` handler
     clears the class so the next click can re-trigger.
     CRITICAL: these hooks MUST live above the early-`return null`
     guard further down — placing them below caused Rules-of-Hooks
     violations because rows that returned null skipped the hook
     calls, and React crashed with a hook-count mismatch on the
     next render (grey screen on Home reload). */
  const chevronRef = useRef<HTMLSpanElement>(null);
  const handleTitleClick = useCallback(() => {
    if (titleAffordance === "refresh" && chevronRef.current) {
      const el = chevronRef.current;
      /* Force a reflow between class removals/additions so a rapid
         second click can re-trigger the animation. Without this, the
         browser may coalesce the remove+add and skip the second
         playback because the class state appears unchanged at flush
         time. */
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

  /* Entrance animation — when `skipEntrance` is true (Home → Library
     → Home roundtrips) the row starts already visible so no fade
     happens. Without this guard, every remount replays opacity:0 →
     animation, and with 30 rows × 60ms stagger that's a ≈2s window of
     blank viewport on every Home return. */
  const [isVisible, setIsVisible] = useState(skipEntrance);
  useEffect(() => {
    if (skipEntrance) return;
    const id = setTimeout(() => setIsVisible(true), animationDelay);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Bi-directional row windowing ────────────────────────────
        Cards mount when the row scrolls within ~1500px of the viewport
        AND unmount again when the row leaves that window. Without the
        unmount side, mounted card count grew monotonically with scroll
        depth — by the time the user reached the bottom, ~40 rows × 6+
        cards each were live in the DOM, and every drag-frame the
        compositor maintained / style-recalculated all of them. Drag
        cost scaled with total mounted cards regardless of which row
        was being dragged.

        With windowing, mounted card count stays bounded to "rows
        within ~1.5 viewports" ≈ 5–8 rows × 6–10 cards. Drag cost
        becomes independent of how far the user has scrolled.

        The skeleton placeholders below render whenever `rowInView` is
        false (or loading is in flight), so the row's height stays
        exactly the same when cards mount/unmount — vertical scroll
        position is preserved across the window churn.

        Pin-open during drag: if the user is mid-drag when the observer
        would unmount, ignore that transition. `stopDrag()` re-evaluates
        once they release. */
  const [rowInView, setRowInView] = useState(false);

  /* Horizontal scroll memory. When the row unmounts its cards, we
     stash the current scrollLeft and restore it on remount so the
     user's "I was at card 8" state survives the window churn. */
  const savedScrollLeftRef = useRef(0);

  /* Synchronous "am I in viewport NOW?" check. IntersectionObserver
     fires asynchronously — its first callback can be 100–300ms after
     mount, during which `rowInView` stays false and the row keeps
     showing skeletons even for rows the user is already looking at.
     That's the visible "rows take too long to load back" delay when
     returning to Home from another tab.

     This useLayoutEffect runs synchronously after first commit but
     before paint, so a row that's already inside the viewport
     window can seed `rowInView=true` immediately and its cards
     mount on the very first paint. Subsequent updates flow through
     the observer below as normal. */
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

  /* Unmount-side debounce. During fast vertical scroll, rows can
     cross the windowing boundary in rapid succession — without a
     defer, every transit would synchronously trigger a React state
     change + unmount/remount cycle, and dozens of those competing
     with the scroll frame produced the "vertical scroll feels rough"
     regression. With a 300ms tail, rows that scroll briefly out and
     back stay mounted; only rows that stay out long enough actually
     unmount. */
  const unmountTimerRef = useRef<number | null>(null);

  /* Scroll-idle gate. The Home-level scroll listener flips
     `isScrollingRef` true on each scroll tick and back to false
     150 ms after the last tick. While true, the observer queues its
     target rowInView in `pendingRowInViewRef` instead of applying it
     — that's what eliminates Layerize bursts mid-scroll (the trace
     pinned ~30 ms Layerize blocks on every blur-card mount). On the
     true → false transition the Home bus calls our subscriber, which
     drains the pending value. */
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
      /* Mounts (`next === true`) ALWAYS apply immediately, even
         mid-scroll. Deferring mounts caused returning-to-Home cards
         to keep showing skeletons while the user scrolled past
         them — the worst kind of perceived sluggishness (visible
         emptiness). The Layerize cost of mounting is acceptable
         here because the user is looking AT that row right now;
         the cost the trace flagged was unmount churn (rows
         leaving the window during scroll), which is what we still
         queue.

         Unmounts (`next === false`) queue mid-scroll and drain on
         scroll-idle. */
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
          /* Cancel any pending unmount — the row re-entered the
             window before the timer fired, so no churn is needed. */
          clearTimer();
          applyInView(true);
        } else {
          /* Pin open while the user is actively dragging this row.
             Unmounting cards mid-drag would yank the content out from
             under their cursor. */
          if (isDragging.current) return;
          /* Persist scrollLeft NOW (before any debounce delay). Even
             if the row eventually unmounts, the saved value reflects
             where the user last left it. */
          if (scrollRef.current) {
            savedScrollLeftRef.current = scrollRef.current.scrollLeft;
          }
          /* Defer the unmount. Rapid in/out during scroll won't churn
             React state — the timer is reset on each new transit. */
          clearTimer();
          unmountTimerRef.current = window.setTimeout(() => {
            unmountTimerRef.current = null;
            applyInView(false);
          }, 300);
        }
      },
      /* Mount-ahead margin bumped to 2400px (was 1500). At higher
         margins the row mounts further in advance of the visible
         area, spreading the mount work across more time so fast
         vertical scrolls don't bunch up dozens of card mounts into
         a single frame budget. The unmount side is still capped by
         the debounce above. Net mounted-row count rises slightly
         (~6-8 → ~8-10), still bounded and still safe for drag. */
      { rootMargin: "2400px 0px" }
    );
    obs.observe(target);
    /* Scroll-idle subscriber — fires once each scroll-stop. Flushes
       any queued rowInView value. No-op when nothing pending. */
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

  /* Restore horizontal scrollLeft right after cards remount. Runs
     synchronously after DOM mutation but before paint, so the user
     never sees a single-frame flash at scrollLeft=0 between mount
     and restore. Cards have fixed widths via CSS, so the scroll
     container's contentWidth is correct by the time this fires —
     image loads happen later but don't affect layout width. */
  useLayoutEffect(() => {
    if (!rowInView || !scrollRef.current) return;
    if (savedScrollLeftRef.current > 0) {
      scrollRef.current.scrollLeft = savedScrollLeftRef.current;
    }
  }, [rowInView]);

  /* ── Within-row card lazy rendering ────────────────────────
        Even once the row is in view, only render the first batch of
        cards. As the user drags/scrolls right past the threshold,
        grow the visible count. Keeps the live DOM small in long rows. */
  const [visibleCardCount, setVisibleCardCount] = useState(
    INITIAL_VISIBLE_CARDS
  );

  const { width: cardWidth, gap: cardGap } = CARD_SIZES[cardStyle];
  const scrollStep = CARDS_PER_CLICK * (cardWidth + cardGap);

  const updateArrows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 0);

    /* Reveal more cards when the user nears the right edge of the
       currently rendered set. */
    if (visibleCardCount < games.length) {
      const renderedWidth = visibleCardCount * (cardWidth + cardGap);
      const visibleRight = el.scrollLeft + el.clientWidth;
      if (visibleRight > renderedWidth - 400) {
        setVisibleCardCount((c) => Math.min(c + CARD_BATCH_SIZE, games.length));
      }
    }
  }, [cardGap, cardWidth, games.length, visibleCardCount]);

  const onScrollMouseDown = (e: React.MouseEvent) => {
    if (!scrollRef.current) return;
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

  /* Drag-only mousemove on the SCROLL container — runs while the
     user holds mousedown to update scrollLeft. Hover-arrow tracking
     lives on the __viewport instead (see onViewportMouseMove) so it
     doesn't churn as the cursor moves over individual cards or as
     React re-renders the row.

     Synchronous write — `scrollLeft` is written immediately on every
     mousemove. The browser already coalesces multiple style/layout
     reads within a single frame, so the per-event reflow cost is
     low; deferring to rAF adds a full-frame of input → visual latency
     that the user perceives as unresponsiveness. */
  const onScrollMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current || !scrollRef.current) return;
    const diff = e.pageX - startX.current;
    if (Math.abs(diff) > 5) {
      /* First time we cross the drag-detection threshold this
         press, add the --dragging class. This enables the CSS
         pointer-events suppression on cards (kills hover firing
         during the drag) without breaking plain card taps —
         taps never reach this branch because they never move past
         5px. The classList check prevents repeated DOM writes on
         every subsequent move event. */
      if (!hasDragged.current) {
        scrollRef.current.classList.add("home-row__scroll--dragging");
      }
      hasDragged.current = true;
    }
    scrollRef.current.scrollLeft = savedLeft.current - diff;
    /* During a drag, force-hide the overlay arrows. They'd flicker
       under the cursor as the carousel moves anyway. */
    if (arrowHoverRef.current !== null) {
      arrowHoverRef.current = null;
      setArrowHover(null);
    }
  };

  /* Hover-arrow tracking — attached to the __viewport wrapper so:
       (a) the rect we measure against is stable (the viewport
           doesn't scroll — only the inner __scroll does), and
       (b) mousemove fires for any descendant including the arrow
           buttons themselves, so once an arrow is visible and the
           cursor moves onto it, the zone state still says "right"
           (or "left") and the arrow stays open.
     Three zones — left edge, dead middle, right edge — keyed by
     absolute pixel distance from the viewport edges. The center
     band shows neither arrow so the user can hover cards without
     an arrow distracting them. The edge zone (ARROW_EDGE_ZONE_PX
     wide) extends comfortably past the arrow button itself, so
     moving the cursor onto a visible arrow keeps it in the same
     zone — no flicker. The write goes through a ref-backed dedupe
     so identical consecutive zones don't queue React state updates. */
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
    isDragging.current = false;
    /* Clear the drag-suppression class so card hover transitions
       work again. Imperative remove pairs with the imperative add in
       onScrollMouseDown — neither path triggers a React re-render. */
    scrollRef.current?.classList.remove("home-row__scroll--dragging");
    updateArrows();
  };

  const onViewportMouseLeave = () => {
    /* Cursor exited the row entirely — drop both the drag and the
       overlay arrows. */
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

  /* Smooth scroll back to slot 0 whenever `scrollResetSignal`
     changes. The first render (signal === undefined) is skipped via
     the ref guard so we don't fight HomeRow's initial mount layout.
     Only fires on signal CHANGES — used by Picks for you to land
     the user on the first freshly-rolled pick after a reshuffle.

     The visible-card-count drop back to INITIAL_VISIBLE_CARDS is
     DEFERRED to the end of the scroll animation so cards the user
     was viewing stay mounted while the row slides leftward — the
     "slots sliding to first position" visual the user asked for.
     If we drop the count synchronously the row content collapses
     to 6 cards immediately, the scroll then animates an already-
     short content area, and cards 7+ that the user was viewing
     disappear instantly. */
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

  /* Hide rows that genuinely have no content AND aren't currently
     loading. Critical distinction: "no data after loading finished"
     means the fetch returned empty (legitimately no games match) →
     the row should vanish, not sit on skeletons forever. The
     IsLoading flag is the row's signal for "data MIGHT still come"
     — when it's false and games is empty, no data is coming. */
  if (!effectiveIsLoading && games.length === 0 && prefixNode == null)
    return null;

  /* Skeletons mount immediately for every row; real game cards swap
     in once `rowInView` flips true AND loading finished. */
  const showCards = rowInView && !effectiveIsLoading;
  const skeletonClass =
    cardStyle === "vertical"
      ? "home-row__skeleton--vertical"
      : cardStyle === "recently-played"
        ? "home-row__skeleton--recently-played"
        : "home-row__skeleton";

  const visibleGames = games.slice(0, visibleCardCount);

  /* Title is a clickable button when the caller wires onSeeAll,
     otherwise a plain heading. The affordance icon depends on what
     the click actually does — "navigate" rows get a chevron,
     "refresh" rows (Picks for you) get a sync icon to telegraph
     re-roll instead of go-elsewhere. */
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
      className={`home-row${
        isVisible ? " home-row--visible" : ""
      }${skipEntrance ? " home-row--instant" : ""}`}
      style={{ animationDelay: `${animationDelay}ms` } as React.CSSProperties}
    >
      <div className="home-row__header">{titleNode}</div>

      {/* Viewport is always mounted — skeletons while `rowInView` is
          false, real game cards after. Keeps the user from seeing
          empty space during fast vertical scrolls regardless of how
          far ahead the IntersectionObserver fires. */}
      <div
        ref={viewportRef}
        className="home-row__viewport"
        onMouseMove={onViewportMouseMove}
        onMouseLeave={onViewportMouseLeave}
      >
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
            : /* 4 skeletons fill the viewport at default sizing;
                   the previous 8 doubled the offscreen rendering /
                   `react-loading-skeleton` shimmer animation cost
                   without any visible benefit — the user only ever
                   sees the first 3-4 within the viewport before
                   real cards arrive. */
              Array.from({ length: 4 }).map((_, i) => (
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

/* React.memo skips reconciliation entirely when none of HomeRow's props
   (games array ref, title node, isLoading, etc.) changed at the
   shallow-equality level. Paired with the parent's `useMemo` on the
   row-data pipeline (so prop references stay stable across unrelated
   Home re-renders), this prevents 30+ HomeRow trees from re-running
   their JSX on every Home state tick that didn't actually touch their
   data — a meaningful per-render win as the home page grew to 40
   mounted rows. */
export const HomeRow = memo(HomeRowImpl);
