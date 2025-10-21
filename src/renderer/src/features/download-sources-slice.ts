import { createSlice } from "@reduxjs/toolkit";

export interface DownloadSourcesState {
  isImporting: boolean;
}

const initialState: DownloadSourcesState = {
  isImporting: false,
};

export const downloadSourcesSlice = createSlice({
  name: "downloadSources",
  initialState,
  reducers: {
    setIsImportingSources: (state, action) => {
      state.isImporting = action.payload;
    },
  },
});

export const { setIsImportingSources } = downloadSourcesSlice.actions;
