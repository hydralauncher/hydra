import { configureStore } from "@reduxjs/toolkit";
import {
  downloadSlice,
  windowSlice,
  librarySlice,
  userPreferencesSlice,
  userDetailsSlice,
  gameRunningSlice,
  subscriptionSlice,
  catalogueSearchSlice,
  romsSlice,
  newsSlice,
} from "@renderer/features";

export const store = configureStore({
  reducer: {
    window: windowSlice.reducer,
    library: librarySlice.reducer,
    userPreferences: userPreferencesSlice.reducer,
    download: downloadSlice.reducer,
    userDetails: userDetailsSlice.reducer,
    gameRunning: gameRunningSlice.reducer,
    subscription: subscriptionSlice.reducer,
    catalogueSearch: catalogueSearchSlice.reducer,
    roms: romsSlice.reducer,
    news: newsSlice.reducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
