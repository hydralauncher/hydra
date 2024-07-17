import { PayloadAction, createSlice } from "@reduxjs/toolkit";
import { UserFriendModalTab } from "@renderer/pages/shared-modals/user-friend-modal";
import type { FriendRequest, UserDetails } from "@types";

export interface UserDetailsState {
  userDetails: UserDetails | null;
  profileBackground: null | string;
  friendRequests: FriendRequest[] | null;
  showFriendsModal: boolean;
  friendRequetsModalTab: UserFriendModalTab | null;
}

const initialState: UserDetailsState = {
  userDetails: null,
  profileBackground: null,
  friendRequests: null,
  showFriendsModal: false,
  friendRequetsModalTab: null,
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
    setFriendRequests: (
      state,
      action: PayloadAction<FriendRequest[] | null>
    ) => {
      state.friendRequests = action.payload;
    },
    setshowFriendsModal: (state, action: PayloadAction<boolean>) => {
      state.showFriendsModal = action.payload;
    },
    setFriendRequestsModal: (
      state,
      action: PayloadAction<UserFriendModalTab | null>
    ) => {
      state.friendRequetsModalTab = action.payload;
    },
  },
});

export const {
  setUserDetails,
  setProfileBackground,
  setFriendRequests,
  setshowFriendsModal,
  setFriendRequestsModal,
} = userDetailsSlice.actions;
