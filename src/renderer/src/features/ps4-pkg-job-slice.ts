import { PayloadAction, createSlice } from "@reduxjs/toolkit";
import type { Ps4PkgJobEvent } from "@types";

export interface Ps4PkgJobState {
  /** The PS4 PKG job running now (extracting a game or applying an update). */
  job: Ps4PkgJobEvent | null;
}

const initialState: Ps4PkgJobState = {
  job: null,
};

export const ps4PkgJobSlice = createSlice({
  name: "ps4-pkg-job",
  initialState,
  reducers: {
    setPs4PkgJob: (state, action: PayloadAction<Ps4PkgJobEvent | null>) => {
      state.job = action.payload;
    },
  },
});

export const { setPs4PkgJob } = ps4PkgJobSlice.actions;
