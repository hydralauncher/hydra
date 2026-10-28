import { PayloadAction, createSlice } from "@reduxjs/toolkit";
import type {
  GamificationProgress,
  MissionsResponse,
  RewardProgress,
  Trail,
} from "@types";

export interface GamificationState {
  /** The GAMIFICATION feature flag for this user. Off hides every gamification surface. */
  isEnabled: boolean;
  progress: GamificationProgress | null;
  missions: MissionsResponse | null;
  trails: Trail[] | null;
  /** Level shown by the level-up overlay, or null when it is closed. */
  levelUpTo: number | null;
  /** Mission or trail action in flight, shared so only one runs at a time. */
  pendingAction: string | null;
}

const initialState: GamificationState = {
  isEnabled: false,
  progress: null,
  missions: null,
  trails: null,
  levelUpTo: null,
  pendingAction: null,
};

export const gamificationSlice = createSlice({
  name: "gamification",
  initialState,
  reducers: {
    setGamificationEnabled: (state, action: PayloadAction<boolean>) => {
      state.isEnabled = action.payload;
    },
    setGamificationProgress: (
      state,
      action: PayloadAction<GamificationProgress | null>
    ) => {
      state.progress = action.payload;
      if (action.payload === null) {
        state.missions = null;
        state.trails = null;
        state.levelUpTo = null;
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
    showLevelUp: (state, action: PayloadAction<number>) => {
      state.levelUpTo = action.payload;
    },
    dismissLevelUp: (state) => {
      state.levelUpTo = null;
    },
    setGamificationPendingAction: (
      state,
      action: PayloadAction<string | null>
    ) => {
      state.pendingAction = action.payload;
    },
  },
});

export const {
  setGamificationEnabled,
  setGamificationProgress,
  applyRewardProgress,
  setGamificationMissions,
  setGamificationTrails,
  showLevelUp,
  dismissLevelUp,
  setGamificationPendingAction,
} = gamificationSlice.actions;
