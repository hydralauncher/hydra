import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";

import type { Collection } from "@types";

export interface CollectionsState {
  value: Collection[];
}

const initialState: CollectionsState = {
  value: [],
};

export const collectionsSlice = createSlice({
  name: "collections",
  initialState,
  reducers: {
    setCollections: (
      state,
      action: PayloadAction<CollectionsState["value"]>
    ) => {
      state.value = action.payload;
    },
    addCollection: (state, action: PayloadAction<Collection>) => {
      state.value.push(action.payload);
    },
    updateCollection: (state, action: PayloadAction<Collection>) => {
      const index = state.value.findIndex(
        (collection) => collection.id === action.payload.id
      );
      if (index !== -1) {
        state.value[index] = action.payload;
      }
    },
    removeCollection: (state, action: PayloadAction<string>) => {
      state.value = state.value.filter(
        (collection) => collection.id !== action.payload
      );
    },
  },
});

export const {
  setCollections,
  addCollection,
  updateCollection,
  removeCollection,
} = collectionsSlice.actions;
