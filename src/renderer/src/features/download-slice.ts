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
  peakSpeeds: Record<string, number>;
  speedHistory: Record<string, number[]>;
}

const initialState: DownloadState = {
  lastPacket: null,
  gameId: null,
  gamesWithDeletionInProgress: [],
  extraction: null,
  peakSpeeds: {},
  speedHistory: {},
};

export const downloadSlice = createSlice({
  name: "download",
  initialState,
  reducers: {
    setLastPacket: (state, action: PayloadAction<DownloadProgress | null>) => {
      state.lastPacket = action.payload;
      if (!state.gameId && action.payload) state.gameId = action.payload.gameId;

      // Track peak speed and speed history atomically when packet arrives
      if (action.payload?.gameId && action.payload.downloadSpeed != null) {
        const { gameId, downloadSpeed } = action.payload;

        // Update peak speed if this is higher
        const currentPeak = state.peakSpeeds[gameId] || 0;
        if (downloadSpeed > currentPeak) {
          state.peakSpeeds[gameId] = downloadSpeed;
        }

        // Update speed history for chart
        if (!state.speedHistory[gameId]) {
          state.speedHistory[gameId] = [];
        }
        state.speedHistory[gameId].push(downloadSpeed);
        // Keep only last 120 entries
        if (state.speedHistory[gameId].length > 120) {
          state.speedHistory[gameId].shift();
        }
      }
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
    updatePeakSpeed: (
      state,
      action: PayloadAction<{ gameId: string; speed: number }>
    ) => {
      const { gameId, speed } = action.payload;
      const currentPeak = state.peakSpeeds[gameId] || 0;
      if (speed > currentPeak) {
        state.peakSpeeds[gameId] = speed;
      }
    },
    clearPeakSpeed: (state, action: PayloadAction<string>) => {
      state.peakSpeeds[action.payload] = 0;
      state.speedHistory[action.payload] = [];
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
  updatePeakSpeed,
  clearPeakSpeed,
} = downloadSlice.actions;
