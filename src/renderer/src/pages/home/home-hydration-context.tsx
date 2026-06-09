import { createContext, useContext } from "react";

/**
 * Home-wide "show skeletons everywhere" flag.
 *
 * Set to `true` while the initial cache hydration is in flight (or
 * any other situation Home considers "rows aren't ready to commit
 * to a final layout yet"). HomeRow OR's this value with its own
 * `isLoading` prop so every row paints its skeleton placeholders
 * regardless of caller wiring.
 *
 * The purpose is twofold:
 *   1. Stop rows from collapsing to `null` (height = 0) on remount
 *      while their cached data is still hydrating async — that
 *      collapse causes scrollTop restore to land 1-2 rows below
 *      the saved position.
 *   2. Give the user an instant "yes, the page is loading" signal
 *      when they return to Home instead of an empty void.
 *
 * Default false so unwrapped HomeRow usage outside this provider
 * (tests, storybooks) behaves the same as before.
 */
export const HomeHydrationContext = createContext<boolean>(false);

export const useHomeHydration = () => useContext(HomeHydrationContext);
