import { createSlice, original } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";

import type { AchievementProgress, LibraryGame } from "@types";
import { isSameLibraryList, reconcileLibraryGames } from "./library-reconcile";

export interface LibraryState {
  value: LibraryGame[];
  downloadLibrary: LibraryGame[];
  searchQuery: string;
  hasLoaded: boolean;
  isSyncingRemote: boolean;
  isAwaitingAccountLibrary: boolean;
}

const initialState: LibraryState = {
  value: [],
  downloadLibrary: [],
  searchQuery: "",
  hasLoaded: false,
  isSyncingRemote: false,
  isAwaitingAccountLibrary: false,
};

export const librarySlice = createSlice({
  name: "library",
  initialState,
  reducers: {
    setLibrary: (state, action: PayloadAction<LibraryState["value"]>) => {
      const previousDownloadLibrary = original(state.downloadLibrary) ?? [];
      const downloadLibrary = reconcileLibraryGames(
        previousDownloadLibrary,
        action.payload
      );

      if (downloadLibrary !== previousDownloadLibrary) {
        state.downloadLibrary = downloadLibrary as LibraryGame[];

        const value = downloadLibrary.filter((game) => !game.isConcealed);
        if (!isSameLibraryList(original(state.value) ?? [], value)) {
          state.value = value;
        }
      }

      state.hasLoaded = true;
    },
    upsertLibraryGames: (state, action: PayloadAction<LibraryGame[]>) => {
      const previousDownloadLibrary = original(state.downloadLibrary) ?? [];
      const indexByKey = new Map(
        previousDownloadLibrary.map((game, index) => [
          `${game.shop}:${game.objectId}`,
          index,
        ])
      );
      const downloadLibrary = [...previousDownloadLibrary];
      for (const game of action.payload) {
        const index = indexByKey.get(`${game.shop}:${game.objectId}`);
        if (index === undefined) downloadLibrary.push(game);
        else downloadLibrary[index] = game;
      }

      const reconciled = reconcileLibraryGames(
        previousDownloadLibrary,
        downloadLibrary
      );
      if (reconciled === previousDownloadLibrary) return;

      state.downloadLibrary = reconciled as LibraryGame[];
      const value = reconciled.filter((game) => !game.isConcealed);
      if (!isSameLibraryList(original(state.value) ?? [], value)) {
        state.value = value;
      }
    },
    setLibrarySyncingRemote: (state, action: PayloadAction<boolean>) => {
      state.isSyncingRemote = action.payload;
    },
    setLibraryAwaitingAccount: (state, action: PayloadAction<boolean>) => {
      state.isAwaitingAccountLibrary = action.payload;
    },

    updateGameNewDownloadOptions: (
      state,
      action: PayloadAction<{ gameId: string; count: number }>
    ) => {
      for (const library of [state.value, state.downloadLibrary]) {
        const game = library.find((g) => g.id === action.payload.gameId);
        if (game) {
          game.newDownloadOptionsCount = action.payload.count;
        }
      }
    },
    clearNewDownloadOptions: (
      state,
      action: PayloadAction<{ gameId: string }>
    ) => {
      for (const library of [state.value, state.downloadLibrary]) {
        const game = library.find((g) => g.id === action.payload.gameId);
        if (game) {
          game.newDownloadOptionsCount = undefined;
        }
      }
    },
    setLibrarySearchQuery: (state, action: PayloadAction<string>) => {
      state.searchQuery = action.payload;
    },
    setGameAchievementProgress: (
      state,
      action: PayloadAction<{
        shop: LibraryGame["shop"];
        objectId: string;
        progress: AchievementProgress;
      }>
    ) => {
      const { shop, objectId, progress } = action.payload;
      for (const library of [state.value, state.downloadLibrary]) {
        const game = library.find(
          (g) => g.shop === shop && g.objectId === objectId
        );

        if (game) {
          game.achievementProgress = progress;
          game.achievementCount = progress.achievementCount;
          game.unlockedAchievementCount = progress.unlockedAchievementCount;
        }
      }
    },
    setGamePlaytime: (
      state,
      action: PayloadAction<
        Pick<
          LibraryGame,
          | "shop"
          | "objectId"
          | "playTimeInMilliseconds"
          | "steamPlayTimeInMilliseconds"
          | "epicPlayTimeInMilliseconds"
          | "lastTimePlayed"
          | "hasManuallyUpdatedPlaytime"
        >
      >
    ) => {
      const { shop, objectId, ...playtime } = action.payload;
      for (const library of [state.value, state.downloadLibrary]) {
        const game = library.find(
          (g) => g.shop === shop && g.objectId === objectId
        );

        if (game) Object.assign(game, playtime);
      }
    },
    setGameCollectionIds: (
      state,
      action: PayloadAction<{
        shop: LibraryGame["shop"];
        objectId: string;
        collectionIds: string[];
      }>
    ) => {
      for (const library of [state.value, state.downloadLibrary]) {
        const game = library.find(
          (g) =>
            g.shop === action.payload.shop &&
            g.objectId === action.payload.objectId
        );

        if (game) {
          game.collectionIds = action.payload.collectionIds;
        }
      }
    },
  },
});

export const {
  setLibrary,
  upsertLibraryGames,
  setLibrarySyncingRemote,
  setLibraryAwaitingAccount,
  updateGameNewDownloadOptions,
  clearNewDownloadOptions,
  setLibrarySearchQuery,
  setGameCollectionIds,
  setGameAchievementProgress,
  setGamePlaytime,
} = librarySlice.actions;

export const selectIsLibraryLoading = (state: { library: LibraryState }) =>
  !state.library.hasLoaded ||
  (state.library.isSyncingRemote &&
    (state.library.value.length === 0 ||
      state.library.isAwaitingAccountLibrary));
