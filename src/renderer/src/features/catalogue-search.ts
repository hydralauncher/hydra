import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";

import type { CatalogueSearchPayload } from "@types";

export interface CatalogueSearchState {
  value: CatalogueSearchPayload;
}

const initialState: CatalogueSearchState = {
  value: {
    title: "",
    downloadSourceFingerprints: [],
    tags: [],
    publishers: [],
    genres: [],
    developers: [],
  },
};

export const catalogueSearchSlice = createSlice({
  name: "catalogueSearch",
  initialState,
  reducers: {
    setSearch: (
      state,
      action: PayloadAction<Partial<CatalogueSearchPayload>>
    ) => {
      state.value = { ...state.value, ...action.payload };
    },
    clearSearch: (state) => {
      state.value = initialState.value;
    },
  },
});

export const { setSearch, clearSearch } = catalogueSearchSlice.actions;
