import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";

interface RepackersFriendlyNamesState {
  value: Record<string, string>;
}

const initialState: RepackersFriendlyNamesState = {
  value: {},
};

export const repackersFriendlyNamesSlice = createSlice({
  name: "repackersFriendlyNames",
  initialState,
  reducers: {
    setRepackersFriendlyNames: (
      state,
      action: PayloadAction<RepackersFriendlyNamesState["value"]>
    ) => {
      state.value = action.payload;
    },
  },
});

export const { setRepackersFriendlyNames } =
  repackersFriendlyNamesSlice.actions;
