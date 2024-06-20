import { PayloadAction, createSlice } from "@reduxjs/toolkit";
import { GameRunning } from "@types";

export interface GameRunningState {
  gameRunning: GameRunning | null;
}

const initialState: GameRunningState = {
  gameRunning: null,
};

export const gameRunningSlice = createSlice({
  name: "running-game",
  initialState,
  reducers: {
    setGameRunning: (state, action: PayloadAction<GameRunning | null>) => {
      state.gameRunning = action.payload;
    },
  },
});

export const { setGameRunning } = gameRunningSlice.actions;
