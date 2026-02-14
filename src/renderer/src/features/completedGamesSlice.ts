import { createSlice, createSelector } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "@renderer/store";

export interface CompletedGamesState {
  completedGames: Record<string, boolean>;
}

const initialState: CompletedGamesState = {
  completedGames: {},
};

export const completedGamesSlice = createSlice({
  name: "completedGames",
  initialState,
  reducers: {
    toggleCompleted: (state, action: PayloadAction<string>) => {
      const gameId = action.payload;
      if (state.completedGames[gameId]) {
        delete state.completedGames[gameId];
      } else {
        state.completedGames[gameId] = true;
      }
    },
    setCompleted: (state, action: PayloadAction<string>) => {
      const gameId = action.payload;
      state.completedGames[gameId] = true;
    },
    unsetCompleted: (state, action: PayloadAction<string>) => {
      const gameId = action.payload;
      delete state.completedGames[gameId];
    },
    hydrateCompleted: (
      state,
      action: PayloadAction<Record<string, boolean>>
    ) => {
      state.completedGames = action.payload;
    },
  },
});

export const { toggleCompleted, setCompleted, unsetCompleted, hydrateCompleted } =
  completedGamesSlice.actions;

// Selector to get all completed games
export const selectCompletedGames = (state: RootState) =>
  state.completedGames.completedGames;

// Memoized selector factory for checking if a specific game is completed
export const makeSelectIsCompleted = () =>
  createSelector(
    [selectCompletedGames, (_state: RootState, gameId: string) => gameId],
    (completedGames, gameId) => {
      return !!completedGames[gameId];
    }
  );
