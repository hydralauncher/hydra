import { configureStore } from "@reduxjs/toolkit";
import {
  downloadSlice,
  windowSlice,
  librarySlice,
  repackersFriendlyNamesSlice,
  searchSlice,
  userPreferencesSlice,
} from "@renderer/features";

export const store = configureStore({
  reducer: {
    search: searchSlice.reducer,
    repackersFriendlyNames: repackersFriendlyNamesSlice.reducer,
    window: windowSlice.reducer,
    library: librarySlice.reducer,
    userPreferences: userPreferencesSlice.reducer,
    download: downloadSlice.reducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
