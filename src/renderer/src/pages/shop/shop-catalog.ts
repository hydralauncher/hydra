// Mock catalog from the designer's prototype (v4.2.0). There is no shop API yet
// (LBX-1255) and no real frame sets, so every item shows the sample Aurora frame.
// Swap this file for the API once both exist.

export interface ShopItem {
  id: string;
  name: string;
  price: number;
  isAnimated: boolean;
  levelRequired?: number;
  isNew?: boolean;
  isOwned?: boolean;
  isEquipped?: boolean;
}

export interface FeaturedShopItem extends ShopItem {
  description: string;
}

export const FEATURED_ITEM: FeaturedShopItem = {
  id: "a-aurora",
  name: "Aurora",
  price: 1800,
  isAnimated: true,
  isNew: true,
  description:
    "Faixas de luz verde, azul e violeta que se dobram em volta do seu avatar, como a aurora boreal vista do norte.",
};

export const SHOP_ITEMS: ShopItem[] = [
  {
    id: "a-glitch",
    name: "Glitch",
    price: 600,
    isAnimated: true,
    isOwned: true,
  },
  {
    id: "a-pulse",
    name: "Pulso",
    price: 500,
    isAnimated: true,
    levelRequired: 15,
  },
  {
    id: "a-orbit",
    name: "Órbita",
    price: 900,
    isAnimated: true,
    isOwned: true,
  },
  {
    id: "a-arcade",
    name: "Fliperama",
    price: 800,
    isAnimated: true,
    isNew: true,
    isOwned: true,
  },
  { id: "a-snake", name: "Cobrinha", price: 700, isAnimated: true },
  { id: "a-bolt", name: "Relâmpago", price: 1200, isAnimated: true },
  { id: "a-embers", name: "Brasas", price: 1100, isAnimated: true },
  { id: "a-rays", name: "Raios de sol", price: 1400, isAnimated: true },
  {
    id: "a-silver",
    name: "Metal · Prata",
    price: 1000,
    isAnimated: true,
    isOwned: true,
  },
  {
    id: "a-gold",
    name: "Metal · Ouro",
    price: 2500,
    isAnimated: true,
    levelRequired: 30,
  },
  {
    id: "a-sakura",
    name: "Sakura",
    price: 1500,
    isAnimated: true,
    isOwned: true,
  },
  {
    id: "f-tracejada",
    name: "Tracejada",
    price: 400,
    isAnimated: false,
    isOwned: true,
    isEquipped: true,
  },
  {
    id: "f-dupla",
    name: "Dupla",
    price: 750,
    isAnimated: false,
    isOwned: true,
  },
  {
    id: "f-colchetes",
    name: "Colchetes",
    price: 600,
    isAnimated: false,
    levelRequired: 15,
  },
  {
    id: "f-pontilhada",
    name: "Pontilhada",
    price: 900,
    isAnimated: false,
    isNew: true,
    isOwned: true,
  },
  { id: "f-orbita", name: "Órbita", price: 1200, isAnimated: false },
  {
    id: "f-hidra",
    name: "Hidra",
    price: 1500,
    isAnimated: false,
    levelRequired: 30,
  },
];

export type ShopCategory = "all" | "animated" | "simple";

export type ShopItemState = "owned" | "locked" | "short" | "buy";

export const getShopItemState = (
  item: ShopItem,
  level: number,
  coins: number
): ShopItemState => {
  if (item.isOwned) return "owned";
  if (item.levelRequired && item.levelRequired > level) return "locked";
  return coins >= item.price ? "buy" : "short";
};
