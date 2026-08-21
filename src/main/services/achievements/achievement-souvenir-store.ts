import type { GameShop } from "@types";

const entries = new Map<string, Map<string, string>>();

const gameKey = (shop: GameShop, objectId: string) => `${shop}:${objectId}`;

export const AchievementSouvenirStore = {
  get(shop: GameShop, objectId: string) {
    return entries.get(gameKey(shop, objectId));
  },

  set(shop: GameShop, objectId: string, souvenirs: Map<string, string>) {
    entries.set(gameKey(shop, objectId), souvenirs);
  },

  invalidate(shop: GameShop, objectId: string) {
    entries.delete(gameKey(shop, objectId));
  },

  clear() {
    entries.clear();
  },
};
