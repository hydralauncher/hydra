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
    setUserDetails: (state, action: PayloadAction<UserDetails | null>) => {
      state.userDetails = action.payload;
    },
    setProfileBackground: (state, action: PayloadAction<string | null>) => {
      state.profileBackground = action.payload;
    },
  },
});

export const { setUserDetails, setProfileBackground } =
  userDetailsSlice.actions;
