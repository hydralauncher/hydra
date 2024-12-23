import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";

import type { CatalogueSearchPayload } from "@types";

export interface CatalogueSearchState {
  filters: CatalogueSearchPayload;
  page: number;
}

const initialState: CatalogueSearchState = {
  filters: {
    title: "",
    downloadSourceFingerprints: [],
    tags: [],
    publishers: [],
    genres: [],
    developers: [],
  },
  page: 1,
};

export const catalogueSearchSlice = createSlice({
  name: "catalogueSearch",
  initialState,
  reducers: {
    setFilters: (
      state,
      action: PayloadAction<Partial<CatalogueSearchPayload>>
    ) => {
      state.filters = { ...state.filters, ...action.payload };
      state.page = initialState.page;
    },
    clearFilters: (state) => {
      state.filters = initialState.filters;
      state.page = initialState.page;
    },
    setPage: (state, action: PayloadAction<number>) => {
      state.page = action.payload;
    },
    clearPage: (state) => {
      state.page = initialState.page;
    },
  },
});

export const { setFilters, clearFilters, setPage, clearPage } =
  catalogueSearchSlice.actions;
