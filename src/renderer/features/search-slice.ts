import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";

import type { CatalogueEntry } from "@types";

interface SearchState {
  value: string;
  results: CatalogueEntry[];
  isLoading: boolean;
}

const initialState: SearchState = {
  value: "",
  results: [],
  isLoading: false,
};

export const searchSlice = createSlice({
  name: "search",
  initialState,
  reducers: {
    setSearch: (state, action: PayloadAction<string>) => {
      state.isLoading = true;
      state.value = action.payload;
    },
    clearSearch: (state) => {
      state.value = "";
    },
    setSearchResults: (state, action: PayloadAction<CatalogueEntry[]>) => {
      state.isLoading = false;
      state.results = action.payload;
    },
  },
});

export const { setSearch, clearSearch, setSearchResults } = searchSlice.actions;
