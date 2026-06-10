import { createContext, useContext } from "react";
import type { HomeRowGame } from "./home-game-card";

export interface HomeFriend {
  id: string;
  displayName: string;
  profileImageUrl: string | null;
}

export type HomeFriendsByGameKey = Map<string, HomeFriend[]>;

const HomeFriendsContext = createContext<HomeFriendsByGameKey>(new Map());

export const HomeFriendsProvider = HomeFriendsContext.Provider;

export function useFriendsForGame(
  game: Pick<HomeRowGame, "shop" | "objectId">
): HomeFriend[] {
  const map = useContext(HomeFriendsContext);
  return map.get(`${game.shop}:${game.objectId}`) ?? [];
}
