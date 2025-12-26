import type { GameShop } from "@types";

export const levelKeys = {
  games: "games",
  game: (shop: GameShop, objectId: string) => `${shop}:${objectId}`,
  user: "user",
  auth: "auth",
  themes: "themes",
  gameShopAssets: "gameShopAssets",
  gameStatsCache: "gameStatsAssets",
  gameShopCache: "gameShopCache",
  gameShopCacheItem: (shop: GameShop, objectId: string, language: string) =>
    `${shop}:${objectId}:${language}`,
  gameAchievements: "gameAchievements",
  downloads: "downloads",
  userPreferences: "userPreferences",
  language: "language",
  screenState: "screenState",
  rpcPassword: "rpcPassword",
  downloadSources: "downloadSources",
  downloadSourcesCheckBaseline: "downloadSourcesCheckBaseline", // When we last started the app
  downloadSourcesSinceValue: "downloadSourcesSinceValue", // The 'since' value API used (for modal comparison)
  localNotifications: "localNotifications",
};
