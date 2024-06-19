import { PayloadAction, createSlice } from "@reduxjs/toolkit";
import { RunningGame } from "@types";

export interface RunningGameState {
  runningGame: RunningGame | null;
}

const initialState: RunningGameState = {
  runningGame: null,
};

export const runningGameSlice = createSlice({
  name: "running-game",
  initialState,
  reducers: {
    setRunningGame: (state, action: PayloadAction<RunningGame | null>) => {
      state.runningGame = action.payload;
    },
  },
});

export const { setRunningGame } = runningGameSlice.actions;
