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
        previousCollectionId: string | null;
        nextCollectionId: string | null;
      }>
    ) => {
      const { previousCollectionId, nextCollectionId } = action.payload;

      if (previousCollectionId && previousCollectionId !== nextCollectionId) {
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

      if (nextCollectionId && previousCollectionId !== nextCollectionId) {
        const nextCollection = state.items.find(
          (collection) => collection.id === nextCollectionId
        );

        if (nextCollection) {
          nextCollection.gamesCount += 1;
        }
      }
    },
  },
});

export const {
  setCollections,
  setCollectionsLoading,
  addCollection,
  applyCollectionAssignment,
} = collectionsSlice.actions;
