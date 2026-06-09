/* Provides a read-only Map from `${shop}:${objectId}` → list of friends
   currently playing that game. Used by every Home card variant to
   conditionally render the "friends playing this game" icon + tooltip.

   Lives in a Context (not threaded through each spec.render closure)
   so the friend data updates in-place when the underlying `/profile/
   friends` response changes — without forcing the row spec list to
   rebuild on every friend tick. */

import { createContext, useContext } from "react";
import type { HomeRowGame } from "./home-game-card";

export interface HomeFriend {
  id: string;
  displayName: string;
  profileImageUrl: string | null;
}

export type HomeFriendsByGameKey = Map<string, HomeFriend[]>;

/* Default to empty Map so consuming cards outside the provider (e.g.
   the catalogue page, if/when these cards get reused) silently render
   without the friends slot rather than crash. */
const HomeFriendsContext = createContext<HomeFriendsByGameKey>(new Map());

export const HomeFriendsProvider = HomeFriendsContext.Provider;

/** Look up the list of friends currently playing `game`. Returns
 *  an empty array when no friends play it or no provider is wired
 *  up — cards can use `result.length > 0` to decide whether to
 *  render their friends-slot. */
export function useFriendsForGame(
  game: Pick<HomeRowGame, "shop" | "objectId">
): HomeFriend[] {
  const map = useContext(HomeFriendsContext);
  return map.get(`${game.shop}:${game.objectId}`) ?? [];
}
