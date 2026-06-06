import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import type { CrackCalendarGame, CrackCalendarMonth } from "@types";

interface CrackCalendarState {
  availableMonths: string[];
  monthCache: Record<string, CrackCalendarMonth>;
  selectedMonth: string | null;
  isLoading: boolean;
  searchResults: CrackCalendarGame[];
  isSearching: boolean;
  searchQuery: string;
}

const initialState: CrackCalendarState = {
  availableMonths: [],
  monthCache: {},
  selectedMonth: null,
  isLoading: false,
  searchResults: [],
  isSearching: false,
  searchQuery: "",
};

export const fetchAvailableMonths = createAsyncThunk(
  "crackCalendar/fetchAvailableMonths",
  async () => {
    return window.electron.getCrackCalendarMonths();
  }
);

export const fetchCalendarMonth = createAsyncThunk(
  "crackCalendar/fetchCalendarMonth",
  async (
    { month, bypassCache }: { month: string; bypassCache?: boolean },
    { getState }
  ) => {
    const state = getState() as { crackCalendar: CrackCalendarState };
    if (!bypassCache && state.crackCalendar.monthCache[month]) {
      return state.crackCalendar.monthCache[month];
    }
    return window.electron.getCrackCalendarMonth(month);
  }
);

export const searchCalendar = createAsyncThunk(
  "crackCalendar/searchCalendar",
  async (query: string) => {
    if (!query) return [];
    return window.electron.searchCrackCalendar(query);
  }
);

export const crackCalendarSlice = createSlice({
  name: "crackCalendar",
  initialState,
  reducers: {
    setSelectedMonth: (state, action: PayloadAction<string>) => {
      state.selectedMonth = action.payload;
    },
    setIsSearching: (state, action: PayloadAction<boolean>) => {
      state.isSearching = action.payload;
    },
    setCalendarSearchQuery: (state, action: PayloadAction<string>) => {
      state.searchQuery = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAvailableMonths.fulfilled, (state, action) => {
        state.availableMonths = Array.isArray(action.payload)
          ? action.payload
          : [];
      })
      .addCase(fetchCalendarMonth.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(fetchCalendarMonth.fulfilled, (state, action) => {
        state.isLoading = false;
        if (action.payload) {
          state.monthCache[action.payload.month] = action.payload;
          state.selectedMonth = action.payload.month;
        }
      })
      .addCase(fetchCalendarMonth.rejected, (state) => {
        state.isLoading = false;
      })
      .addCase(searchCalendar.pending, (state) => {
        state.isSearching = true;
      })
      .addCase(searchCalendar.fulfilled, (state, action) => {
        state.isSearching = false;
        state.searchResults = Array.isArray(action.payload)
          ? action.payload
          : [];
      })
      .addCase(searchCalendar.rejected, (state) => {
        state.isSearching = false;
      });
  },
});

export const { setSelectedMonth, setIsSearching, setCalendarSearchQuery } =
  crackCalendarSlice.actions;
