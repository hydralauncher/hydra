import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";

import type { LibraryGame } from "@types";

export interface LibraryState {
  value: LibraryGame[];
}

const initialState: LibraryState = {
  value: [],
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
  },
});

export const {
  setLibrary,
  updateGameNewDownloadOptions,
  clearNewDownloadOptions,
} = librarySlice.actions;
