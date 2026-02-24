import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import type { GameCollection } from "@types";

export interface CollectionsState {
  items: GameCollection[];
  isLoading: boolean;
  hasLoaded: boolean;
}

const initialState: CollectionsState = {
  items: [],
  isLoading: false,
  hasLoaded: false,
};

const sortByName = (collections: GameCollection[]) => {
  collections.sort((a, b) => a.name.localeCompare(b.name));
};

export const collectionsSlice = createSlice({
  name: "collections",
  initialState,
  reducers: {
    setCollections: (state, action: PayloadAction<GameCollection[]>) => {
      state.items = [...action.payload];
      sortByName(state.items);
      state.hasLoaded = true;
      state.isLoading = false;
    },
    setCollectionsLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    addCollection: (state, action: PayloadAction<GameCollection>) => {
      state.items.push(action.payload);
      sortByName(state.items);
    },
    applyCollectionAssignment: (
      state,
      action: PayloadAction<{
        previousCollectionIds: string[];
        nextCollectionIds: string[];
      }>
    ) => {
      const { previousCollectionIds, nextCollectionIds } = action.payload;

      const previousIdsSet = new Set(previousCollectionIds);
      const nextIdsSet = new Set(nextCollectionIds);

      for (const previousCollectionId of previousIdsSet) {
        if (nextIdsSet.has(previousCollectionId)) {
          continue;
        }

        const previousCollection = state.items.find(
          (collection) => collection.id === previousCollectionId
        );

        if (previousCollection) {
          previousCollection.gamesCount = Math.max(
            0,
            previousCollection.gamesCount - 1
          );
        }
      }

      for (const nextCollectionId of nextIdsSet) {
        if (previousIdsSet.has(nextCollectionId)) {
          continue;
        }

        const nextCollection = state.items.find(
          (collection) => collection.id === nextCollectionId
        );

        if (nextCollection) {
          nextCollection.gamesCount += 1;
        }
      }
    },
    clearCollections: (state) => {
      state.items = [];
      state.isLoading = false;
      state.hasLoaded = false;
    },
  },
});

export const {
  setCollections,
  setCollectionsLoading,
  addCollection,
  applyCollectionAssignment,
  clearCollections,
} = collectionsSlice.actions;
