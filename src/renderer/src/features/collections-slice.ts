import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import { Collection } from "../../../types/index";

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
  },
});

export const { setCollections } = collectionsSlice.actions;
