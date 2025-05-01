import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";

import type { LibraryGame } from "@types";

export interface LibraryState {
  value: LibraryGame[];
  searchQuery: string;
  filteredValue: LibraryGame[];
}

const initialState: LibraryState = {
  value: [],
  searchQuery: "",
  filteredValue: [],
};

export const librarySlice = createSlice({
  name: "library",
  initialState,
  reducers: {
    setLibrary: (state, action: PayloadAction<LibraryState["value"]>) => {
      state.value = action.payload;
      state.filteredValue = filterLibrary(action.payload, state.searchQuery);
    },
    setSearchQuery: (state, action: PayloadAction<string>) => {
      state.searchQuery = action.payload;
      state.filteredValue = filterLibrary(state.value, action.payload);
    },
    clearSearchQuery: (state) => {
      state.searchQuery = "";
      state.filteredValue = state.value;
    },
  },
});

const filterLibrary = (library: LibraryGame[], searchQuery: string): LibraryGame[] => {
  if (!searchQuery) return library;
  const query = searchQuery.toLowerCase();
  return library.filter(game => {
    const titleMatch = game.title.toLowerCase().indexOf(query) !== -1;
    const pathMatch = game.download?.downloadPath
      ? game.download.downloadPath.toLowerCase().indexOf(query) !== -1
      : false;
    return titleMatch || pathMatch;
  });
};

export const { setLibrary, setSearchQuery, clearSearchQuery } = librarySlice.actions;
