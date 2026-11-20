import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";

import type { CatalogueSearchPayload } from "@types";

export type CatalogueMode = "modern" | "classics";

// Set when a game page opens the catalogue on a studio, whose stored names
// can span many filter values; the catalogue shows them as one chip.
export interface CatalogueStudioFilter {
  key: "developers" | "publishers";
  name: string;
  values: string[];
}

export interface CatalogueSearchState {
  filters: CatalogueSearchPayload;
  page: number;
  steamUserTags: Record<string, Record<string, number>>;
  steamGenres: Record<string, string[]>;
  mode: CatalogueMode;
  studioFilter: CatalogueStudioFilter | null;
}

const initialState: CatalogueSearchState = {
  filters: {
    title: "",
    sortBy: "popularity",
    sortOrder: "desc",
    downloadSourceFingerprints: [],
    tags: [],
    publishers: [],
    genres: [],
    developers: [],
    protondbSupportBadges: [],
    deckCompatibility: [],
    platforms: [],
  },
  steamUserTags: {},
  steamGenres: {},
  page: 1,
  mode: "modern",
  studioFilter: null,
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
      state.studioFilter = null;
    },
    setStudioFilter: (
      state,
      action: PayloadAction<CatalogueStudioFilter | null>
    ) => {
      state.studioFilter = action.payload;
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
    setMode: (state, action: PayloadAction<CatalogueMode>) => {
      state.mode = action.payload;
      state.page = initialState.page;
      state.filters = {
        ...state.filters,
        tags: [],
        genres: [],
        developers: [],
        publishers: [],
        downloadSourceFingerprints: [],
        protondbSupportBadges: [],
        deckCompatibility: [],
        releaseYear: undefined,
        platforms: [],
        recompilation: undefined,
      };
      state.studioFilter = null;
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
  setMode,
  setStudioFilter,
} = catalogueSearchSlice.actions;
