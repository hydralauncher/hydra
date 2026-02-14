import { configureStore } from "@reduxjs/toolkit";
import {
  downloadSlice,
  windowSlice,
  librarySlice,
  userPreferencesSlice,
  toastSlice,
  userDetailsSlice,
  gameRunningSlice,
  subscriptionSlice,
  catalogueSearchSlice,
  completedGamesSlice,
  hydrateCompleted,
} from "@renderer/features";

// Load completed games from localStorage on app start
const loadCompletedGamesFromStorage = (): Record<string, boolean> => {
  try {
    const stored = localStorage.getItem("hydra:completedGames");
    if (!stored) return {};

    const parsed = JSON.parse(stored);

    // Validate structure
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      console.warn("Invalid completed games data structure, resetting to empty");
      return {};
    }

    return parsed;
  } catch (error) {
    console.error("Failed to load completed games from localStorage:", error);
    return {};
  }
};

export const store = configureStore({
  reducer: {
    window: windowSlice.reducer,
    library: librarySlice.reducer,
    userPreferences: userPreferencesSlice.reducer,
    download: downloadSlice.reducer,
    toast: toastSlice.reducer,
    userDetails: userDetailsSlice.reducer,
    gameRunning: gameRunningSlice.reducer,
    subscription: subscriptionSlice.reducer,
    catalogueSearch: catalogueSearchSlice.reducer,
    completedGames: completedGamesSlice.reducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// Hydrate completed games from localStorage
const initialCompletedGames = loadCompletedGamesFromStorage();
if (Object.keys(initialCompletedGames).length > 0) {
  store.dispatch(hydrateCompleted(initialCompletedGames));
}

// Throttled save to localStorage
let saveTimeout: NodeJS.Timeout | null = null;
const SAVE_DELAY_MS = 500;

const saveCompletedGamesToStorage = (completedGames: Record<string, boolean>) => {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }

  saveTimeout = setTimeout(() => {
    try {
      localStorage.setItem("hydra:completedGames", JSON.stringify(completedGames));
    } catch (error) {
      // Handle quota exceeded error
      if (error instanceof DOMException && error.name === "QuotaExceededError") {
        console.error("localStorage quota exceeded. Unable to save completed games.");
      } else {
        console.error("Failed to save completed games to localStorage:", error);
      }
    }
  }, SAVE_DELAY_MS);
};

// Subscribe to store changes and persist to localStorage
let previousCompletedGames: Record<string, boolean> | null = null;

store.subscribe(() => {
  const state = store.getState();
  const currentCompletedGames = state.completedGames.completedGames;

  // Only save if completedGames actually changed
  if (currentCompletedGames !== previousCompletedGames) {
    previousCompletedGames = currentCompletedGames;
    saveCompletedGamesToStorage(currentCompletedGames);
  }
});
