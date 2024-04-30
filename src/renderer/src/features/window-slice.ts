import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";

interface WindowState {
  draggingDisabled: boolean;
  headerTitle: string;
}

const initialState: WindowState = {
  draggingDisabled: false,
  headerTitle: "",
};

export const windowSlice = createSlice({
  name: "window",
  initialState,
  reducers: {
    toggleDragging: (state, action: PayloadAction<boolean>) => {
      state.draggingDisabled = action.payload;
    },
    setHeaderTitle: (state, action: PayloadAction<string>) => {
      state.headerTitle = action.payload;
    },
  },
});

export const { toggleDragging, setHeaderTitle } = windowSlice.actions;
