import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import type { client } from "@types";

export interface UserClientPreferencesState {
  value: client | null;
}

const initialState: UserClientPreferencesState = {
  value: null,
};

export const userClientPreferencesSlice = createSlice({
  name: "userClientPreferences",
  initialState,
  reducers: {
    setUserClientPreferences: (
      state,
      action: PayloadAction<client | null>
    ) => {
      state.value = action.payload;
    },
  },
});

export const { setUserClientPreferences } = userClientPreferencesSlice.actions;