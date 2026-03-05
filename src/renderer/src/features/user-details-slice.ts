import { PayloadAction, createSlice } from "@reduxjs/toolkit";
import type { FriendRequest, UserDetails } from "@types";

export interface UserDetailsState {
  userDetails: UserDetails | null;
  profileBackground: null | string;
  friendRequests: FriendRequest[];
  friendRequestCount: number;
}

const initialState: UserDetailsState = {
  userDetails: null,
  profileBackground: null,
  friendRequests: [],
  friendRequestCount: 0,
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
    setFriendRequests: (state, action: PayloadAction<FriendRequest[]>) => {
      state.friendRequests = action.payload;
    },
    setFriendRequestCount: (state, action: PayloadAction<number>) => {
      state.friendRequestCount = action.payload;
    },
  },
});

export const {
  setUserDetails,
  setProfileBackground,
  setFriendRequests,
  setFriendRequestCount,
} = userDetailsSlice.actions;
