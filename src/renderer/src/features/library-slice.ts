import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";

import type { LibraryGame } from "@types";

export interface LibraryState {
  value: LibraryGame[];
  searchQuery: string;
}

const initialState: LibraryState = {
  value: [],
  searchQuery: "",
};

export const librarySlice = createSlice({
  name: "library",
  initialState,
  reducers: {
    setLibrary: (state, action: PayloadAction<LibraryState["value"]>) => {
      state.value = action.payload;
    },

    updateGameNewDownloadOptions: (
      state,
      action: PayloadAction<{ gameId: string; count: number }>
    ) => {
      const game = state.value.find((g) => g.id === action.payload.gameId);
      if (game) {
        game.newDownloadOptionsCount = action.payload.count;
      }
    },
    clearNewDownloadOptions: (
      state,
      action: PayloadAction<{ gameId: string }>
    ) => {
      const game = state.value.find((g) => g.id === action.payload.gameId);
      if (game) {
        game.newDownloadOptionsCount = undefined;
      }
    },
    setLibrarySearchQuery: (state, action: PayloadAction<string>) => {
      state.searchQuery = action.payload;
    },
    setGameCollectionIds: (
      state,
      action: PayloadAction<{
        shop: LibraryGame["shop"];
        objectId: string;
        collectionIds: string[];
      }>
    ) => {
      const game = state.value.find(
        (g) =>
          g.shop === action.payload.shop &&
          g.objectId === action.payload.objectId
      );

      if (game) {
        game.collectionIds = action.payload.collectionIds;
      }
    },
  },
});

export const {
  setLibrary,
  updateGameNewDownloadOptions,
  clearNewDownloadOptions,
  setLibrarySearchQuery,
  setGameCollectionIds,
} = librarySlice.actions;
