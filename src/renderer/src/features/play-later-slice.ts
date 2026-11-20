import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import type { GameShop, PlayLaterEntry } from "@types";

export interface PlayLaterState {
  /** Keyed by `${shop}:${objectId}`, so adding the same game twice is a no-op. */
  items: Record<string, PlayLaterEntry>;
  hasLoaded: boolean;
}

const initialState: PlayLaterState = {
  items: {},
  hasLoaded: false,
};

const keyOf = (shop: GameShop, objectId: string) => `${shop}:${objectId}`;

export const playLaterSlice = createSlice({
  name: "playLater",
  initialState,
  reducers: {
    setPlayLater: (state, action: PayloadAction<PlayLaterEntry[]>) => {
      state.items = Object.fromEntries(
        action.payload.map((entry) => [
          keyOf(entry.shop, entry.objectId),
          entry,
        ])
      );
      state.hasLoaded = true;
    },
    upsertPlayLaterEntry: (state, action: PayloadAction<PlayLaterEntry>) => {
      const { shop, objectId } = action.payload;
      state.items[keyOf(shop, objectId)] = action.payload;
    },
    removePlayLaterEntry: (
      state,
      action: PayloadAction<{ shop: GameShop; objectId: string }>
    ) => {
      delete state.items[keyOf(action.payload.shop, action.payload.objectId)];
    },
  },
});

export const { setPlayLater, upsertPlayLaterEntry, removePlayLaterEntry } =
  playLaterSlice.actions;
