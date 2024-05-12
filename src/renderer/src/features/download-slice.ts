import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import type { TorrentProgress } from "@types";

interface DownloadState {
  lastPacket: TorrentProgress | null;
  gameId: number | null;
  gamesWithDeletionInProgress: number[];
}

const initialState: DownloadState = {
  lastPacket: null,
  gameId: null,
  gamesWithDeletionInProgress: [],
};

export const downloadSlice = createSlice({
  name: "download",
  initialState,
  reducers: {
    setLastPacket: (state, action: PayloadAction<TorrentProgress>) => {
      state.lastPacket = action.payload;
      if (!state.gameId) state.gameId = action.payload.game.id;
    },
    clearDownload: (state) => {
      state.lastPacket = null;
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
  setLastPacket,
  clearDownload,
  setGameDeleting,
  removeGameFromDeleting,
} = downloadSlice.actions;
