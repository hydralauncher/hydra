import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";

interface WindowState {
  draggingDisabled: boolean;
  scrollingDisabled: boolean;
  headerTitle: string;
}

const initialState: WindowState = {
  draggingDisabled: false,
  scrollingDisabled: false,
  headerTitle: "",
};

export const windowSlice = createSlice({
  name: "window",
  initialState,
  reducers: {
    toggleDragging: (state, action: PayloadAction<boolean>) => {
      state.draggingDisabled = action.payload;
    },
    toggleScrolling: (state, action: PayloadAction<boolean>) => {
      state.scrollingDisabled = action.payload;
    },
    setHeaderTitle: (state, action: PayloadAction<string>) => {
      state.headerTitle = action.payload;
    },
  },
});

export const { toggleDragging, toggleScrolling, setHeaderTitle } =
  windowSlice.actions;
