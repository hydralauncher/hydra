import { PayloadAction, createSlice } from "@reduxjs/toolkit";
import type {
  GamificationProgress,
  MissionsResponse,
  RewardProgress,
  Trail,
} from "@types";

export interface GamificationState {
  progress: GamificationProgress | null;
  missions: MissionsResponse | null;
  trails: Trail[] | null;
}

const initialState: GamificationState = {
  progress: null,
  missions: null,
  trails: null,
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
      if (action.payload === null) {
        state.missions = null;
        state.trails = null;
      }
    },
    applyRewardProgress: (state, action: PayloadAction<RewardProgress>) => {
      if (state.progress) {
        state.progress = { ...state.progress, ...action.payload };
      }
    },
    setGamificationMissions: (
      state,
      action: PayloadAction<MissionsResponse | null>
    ) => {
      state.missions = action.payload;
    },
    setGamificationTrails: (state, action: PayloadAction<Trail[] | null>) => {
      state.trails = action.payload;
    },
  },
});

export const {
  setGamificationProgress,
  applyRewardProgress,
  setGamificationMissions,
  setGamificationTrails,
} = gamificationSlice.actions;
