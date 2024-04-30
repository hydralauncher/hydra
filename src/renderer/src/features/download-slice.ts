import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import type { TorrentProgress } from "@types";

interface DownloadState {
  packets: TorrentProgress[];
  gameId: number | null;
  gamesWithDeletionInProgress: number[];
}

const initialState: DownloadState = {
  packets: [],
  gameId: null,
  gamesWithDeletionInProgress: [],
};

export const downloadSlice = createSlice({
  name: "download",
  initialState,
  reducers: {
    addPacket: (state, action: PayloadAction<TorrentProgress>) => {
      state.packets = [...state.packets, action.payload];
      if (!state.gameId) state.gameId = action.payload.game.id;
    },
    clearDownload: (state) => {
      state.packets = [];
      state.gameId = null;
    },
    setGameDeleting: (state, action: PayloadAction<number>) => {
      if (
        !state.gamesWithDeletionInProgress.includes(action.payload) &&
        action.payload
      ) {
        state.gamesWithDeletionInProgress.push(action.payload);
      }
    },
    removeGameFromDeleting: (state, action: PayloadAction<number>) => {
      const index = state.gamesWithDeletionInProgress.indexOf(action.payload);
      if (index >= 0) state.gamesWithDeletionInProgress.splice(index, 1);
    },
  },
});

export const {
  addPacket,
  clearDownload,
  setGameDeleting,
  removeGameFromDeleting,
} = downloadSlice.actions;
