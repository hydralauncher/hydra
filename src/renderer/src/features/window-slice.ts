import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";

export interface WindowState {
  draggingDisabled: boolean;
  headerTitle: string;
  openedFolderName: string | null;
  closeFolderTrigger: number;
}

const initialState: WindowState = {
  draggingDisabled: false,
  headerTitle: "",
  openedFolderName: null,
  closeFolderTrigger: 0,
};

export const windowSlice = createSlice({
  name: "window",
  initialState,
  reducers: {
    toggleDraggingDisabled: (state, action: PayloadAction<boolean>) => {
      state.draggingDisabled = action.payload;
    },
    setHeaderTitle: (state, action: PayloadAction<string>) => {
      state.headerTitle = action.payload;
    },
    setOpenedFolderName: (state, action: PayloadAction<string | null>) => {
      state.openedFolderName = action.payload;
    },
    triggerCloseFolder: (state) => {
      state.closeFolderTrigger += 1;
    },
  },
});

export const {
  toggleDraggingDisabled,
  setHeaderTitle,
  setOpenedFolderName,
  triggerCloseFolder,
} = windowSlice.actions;
