import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";

import type { GameRepack } from "@types";

export interface RepacksState {
  value: GameRepack[];
}

const initialState: RepacksState = {
  value: [],
};

export const repacksSlice = createSlice({
  name: "repacks",
  initialState,
  reducers: {
    setRepacks: (state, action: PayloadAction<RepacksState["value"]>) => {
      state.value = action.payload;
    },
  },
});

export const { setRepacks } = repacksSlice.actions;
