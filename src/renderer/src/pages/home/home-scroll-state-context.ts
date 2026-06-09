import { createContext, useContext } from "react";

/* Home-level scroll-idle bus.
 *
 * Each HomeRow needs to know whether the user is actively scrolling
 * the Home content right now. When they are, the row's
 * IntersectionObserver callback DEFERS the `setRowInView` change
 * (which would otherwise mount or unmount classics blur cards and
 * trigger a ~30 ms Layerize burst mid-scroll). The DevTools trace at
 * Trace-20260609T130504.json.gz pinned Layerize as the dominant cost
 * during scroll motion — eliminating those transitions by queueing
 * them to scroll-stop closes the gap to "100 % fluid".
 *
 * Shape:
 *   `isScrollingRef` — synchronous source of truth for "is the
 *      `.home__content` mid-scroll right now". The row's observer
 *      callback consults this ref instead of subscribing to React
 *      state so the decision is immediate and never triggers an
 *      additional render.
 *   `subscribe(cb)` — register a callback that fires once each time
 *      scroll transitions OUT of active (idle → false → true).
 *      Returns an unsubscribe function. HomeRow uses this to flush
 *      any pending `setRowInView` value it deferred while scrolling.
 *
 * Producer: `home.tsx`'s `.home__content` scroll effect. It flips
 * `isScrollingRef.current = true` on each scroll tick, schedules a
 * 150 ms timer to flip back to false, and invokes every subscribed
 * callback on the false transition.
 */
export interface HomeScrollState {
  isScrollingRef: { current: boolean };
  subscribe: (cb: () => void) => () => void;
}

/* Default value used when a HomeRow renders OUTSIDE the provider
 * (Storybook, tests, etc.). `isScrollingRef.current` stays false so
 * the row applies updates immediately and `subscribe` is a no-op. */
const noopRef = { current: false };
const noopSubscribe = (_cb: () => void): (() => void) => {
  return () => {};
};

export const HomeScrollStateContext = createContext<HomeScrollState>({
  isScrollingRef: noopRef,
  subscribe: noopSubscribe,
});

export const useHomeScrollState = () => useContext(HomeScrollStateContext);
