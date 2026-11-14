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
  collectionsSlice,
  classicsScanSlice,
  retroarchScanSlice,
  gamificationSlice,
  ps4PkgJobSlice,
} from "@renderer/features";

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
    collections: collectionsSlice.reducer,
    classicsScan: classicsScanSlice.reducer,
    retroarchScan: retroarchScanSlice.reducer,
    gamification: gamificationSlice.reducer,
    ps4PkgJob: ps4PkgJobSlice.reducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
