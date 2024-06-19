import { PayloadAction, createSlice } from "@reduxjs/toolkit";
import type { UserDetails } from "@types";

export interface UserDetailsState {
  userDetails: UserDetails | null;
  profileBackground: null | string;
}

const initialState: UserDetailsState = {
  userDetails: null,
  profileBackground: null,
};

export const userDetailsSlice = createSlice({
  name: "user-details",
  initialState,
  reducers: {
    setUserDetails: (state, action: PayloadAction<UserDetails>) => {
      state.userDetails = action.payload;
    },
    setProfileBackground: (state, action: PayloadAction<string>) => {
      state.profileBackground = action.payload;
    },
    clearUserDetails: (state) => {
      state.userDetails = null;
      state.profileBackground = null;
    },
  },
});

export const { setUserDetails, setProfileBackground, clearUserDetails } =
  userDetailsSlice.actions;
