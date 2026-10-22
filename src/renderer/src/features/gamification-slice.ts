import { PayloadAction, createSlice } from "@reduxjs/toolkit";
import type { GamificationProgress } from "@types";

export interface GamificationState {
  progress: GamificationProgress | null;
}

const initialState: GamificationState = {
  progress: null,
};

export const gamificationSlice = createSlice({
  name: "gamification",
  initialState,
  reducers: {
    setGamificationProgress: (
      state,
      action: PayloadAction<GamificationProgress | null>
    ) => {
      state.progress = action.payload;
    },
  },
});

export const { setGamificationProgress } = gamificationSlice.actions;
