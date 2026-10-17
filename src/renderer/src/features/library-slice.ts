import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";

import type { LibraryGame } from "@types";

export interface LibraryState {
  value: LibraryGame[];
  downloadLibrary: LibraryGame[];
  searchQuery: string;
  hasLoaded: boolean;
  isSyncingRemote: boolean;
}

const initialState: LibraryState = {
  value: [],
  downloadLibrary: [],
  searchQuery: "",
  hasLoaded: false,
  isSyncingRemote: false,
};

export const librarySlice = createSlice({
  name: "library",
  initialState,
  reducers: {
    setLibrary: (state, action: PayloadAction<LibraryState["value"]>) => {
      state.value = action.payload.filter((game) => !game.isConcealed);
      state.downloadLibrary = action.payload;
      state.hasLoaded = true;
    },
    setLibrarySyncingRemote: (state, action: PayloadAction<boolean>) => {
      state.isSyncingRemote = action.payload;
    },

    updateGameNewDownloadOptions: (
      state,
      action: PayloadAction<{ gameId: string; count: number }>
    ) => {
      for (const library of [state.value, state.downloadLibrary]) {
        const game = library.find((g) => g.id === action.payload.gameId);
        if (game) {
          game.newDownloadOptionsCount = action.payload.count;
        }
      }
    },
    clearNewDownloadOptions: (
      state,
      action: PayloadAction<{ gameId: string }>
    ) => {
      for (const library of [state.value, state.downloadLibrary]) {
        const game = library.find((g) => g.id === action.payload.gameId);
        if (game) {
          game.newDownloadOptionsCount = undefined;
        }
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
      for (const library of [state.value, state.downloadLibrary]) {
        const game = library.find(
          (g) =>
            g.shop === action.payload.shop &&
            g.objectId === action.payload.objectId
        );

        if (game) {
          game.collectionIds = action.payload.collectionIds;
        }
      }
    },
  },
});

export const {
  setLibrary,
  setLibrarySyncingRemote,
  updateGameNewDownloadOptions,
  clearNewDownloadOptions,
  setLibrarySearchQuery,
  setGameCollectionIds,
} = librarySlice.actions;

export const selectIsLibraryLoading = (state: { library: LibraryState }) =>
  !state.library.hasLoaded ||
  (state.library.isSyncingRemote && state.library.value.length === 0);
