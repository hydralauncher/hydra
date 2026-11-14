import type { ShopFrame } from "@types";

export type ShopFrameState = "owned" | "short" | "buy";

export const getShopFrameState = (
  frame: ShopFrame,
  coins: number
): ShopFrameState => {
  if (frame.isOwned) return "owned";
  return frame.price > coins ? "short" : "buy";
};
