import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";

import type { CatalogueSearchPayload } from "@types";

export interface CatalogueSearchState {
  filters: CatalogueSearchPayload;
  page: number;
  steamUserTags: Record<string, Record<string, number>>;
  steamGenres: Record<string, string[]>;
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
  steamUserTags: {},
  steamGenres: {},
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
    setTags: (
      state,
      action: PayloadAction<Record<string, Record<string, number>>>
    ) => {
      state.steamUserTags = action.payload;
    },
    setGenres: (state, action: PayloadAction<Record<string, string[]>>) => {
      state.steamGenres = action.payload;
    },
  },
});

export const {
  setFilters,
  clearFilters,
  setPage,
  clearPage,
  setTags,
  setGenres,
} = catalogueSearchSlice.actions;
