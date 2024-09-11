import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import type { UserPreferences } from "@types";

export interface UserPreferencesState {
  value: UserPreferences | null;
}

const initialState: UserPreferencesState = {
  value: null,
};

export const userPreferencesSlice = createSlice({
  name: "userPreferences",
  initialState,
  reducers: {
    setUserPreferences: (
      state,
      action: PayloadAction<UserPreferences | null>
    ) => {
      state.value = action.payload;
    },
  },
});

export const { setUserPreferences } = userPreferencesSlice.actions;