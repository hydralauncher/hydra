import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";

import type { CatalogueSearchPayload } from "@types";

export type CatalogueMode = "modern" | "classics";

/** Classics-only filter, applied client-side and never sent to the API. */
export type RecompilationFilter =
  | "all"
  | "has_recompilation"
  | "emulation_only";

export type CatalogueFiltersUpdate = Partial<
  CatalogueSearchPayload & { recompilation: RecompilationFilter }
>;

export interface CatalogueSearchState {
  filters: CatalogueSearchPayload;
  recompilationFilter: RecompilationFilter;
  page: number;
  steamUserTags: Record<string, Record<string, number>>;
  steamGenres: Record<string, string[]>;
  mode: CatalogueMode;
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
  recompilationFilter: "all",
  steamUserTags: {},
  steamGenres: {},
  page: 1,
  mode: "modern",
};

export const catalogueSearchSlice = createSlice({
  name: "catalogueSearch",
  initialState,
  reducers: {
    setFilters: (state, action: PayloadAction<CatalogueFiltersUpdate>) => {
      // `recompilation` is kept out of `filters` so it never reaches the
      // search request and changing it does not refetch the catalogue.
      const { recompilation, ...filters } = action.payload;

      if (recompilation !== undefined) {
        state.recompilationFilter = recompilation;
      }

      // Only request filters go back to the first page: the recompilation
      // filter works on the page that is already loaded.
      if (Object.keys(filters).length > 0) {
        state.filters = { ...state.filters, ...filters };
        state.page = initialState.page;
      }
    },
    clearFilters: (state) => {
      state.filters = initialState.filters;
      state.recompilationFilter = initialState.recompilationFilter;
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
    setMode: (state, action: PayloadAction<CatalogueMode>) => {
      state.mode = action.payload;
      state.page = initialState.page;
      state.recompilationFilter = initialState.recompilationFilter;
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
      };
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
} = catalogueSearchSlice.actions;
