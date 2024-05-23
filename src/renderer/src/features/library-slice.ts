import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";

import type { Game } from "@types";

export interface LibraryState {
  value: Game[];
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
  },
});

export const { setLibrary } = librarySlice.actions;
