import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import type { DownloadProgress, GameShop } from "@types";

export interface ExtractionInfo {
  visibleId: string;
  progress: number;
}

export interface DownloadState {
  lastPacket: DownloadProgress | null;
  gameId: string | null;
  gamesWithDeletionInProgress: string[];
  extraction: ExtractionInfo | null;
}

const initialState: DownloadState = {
  lastPacket: null,
  gameId: null,
  gamesWithDeletionInProgress: [],
  extraction: null,
};

export const downloadSlice = createSlice({
  name: "download",
  initialState,
  reducers: {
    setLastPacket: (state, action: PayloadAction<DownloadProgress | null>) => {
      state.lastPacket = action.payload;
      if (!state.gameId && action.payload) state.gameId = action.payload.gameId;
    },
    clearDownload: (state) => {
      state.lastPacket = null;
      state.gameId = null;
    },
    setGameDeleting: (state, action: PayloadAction<string>) => {
      if (
        !state.gamesWithDeletionInProgress.includes(action.payload) &&
        action.payload
      ) {
        state.gamesWithDeletionInProgress.push(action.payload);
      }
    },
    removeGameFromDeleting: (state, action: PayloadAction<string>) => {
      const index = state.gamesWithDeletionInProgress.indexOf(action.payload);
      if (index >= 0) state.gamesWithDeletionInProgress.splice(index, 1);
    },
    setExtractionProgress: (
      state,
      action: PayloadAction<{
        shop: GameShop;
        objectId: string;
        progress: number;
      }>
    ) => {
      const { shop, objectId, progress } = action.payload;
      state.extraction = {
        visibleId: `${shop}:${objectId}`,
        progress,
      };
    },
    clearExtraction: (state) => {
      state.extraction = null;
    },
  },
});

export const {
  setLastPacket,
  clearDownload,
  setGameDeleting,
  removeGameFromDeleting,
  setExtractionProgress,
  clearExtraction,
} = downloadSlice.actions;
