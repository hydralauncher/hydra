import { PayloadAction, createSlice } from "@reduxjs/toolkit";
import { UserFriendModalTab } from "@renderer/pages/shared-modals/user-friend-modal";
import type { FriendRequest, UserDetails } from "@types";

export interface UserDetailsState {
  userDetails: UserDetails | null;
  profileBackground: null | string;
  friendRequests: FriendRequest[];
  isFriendsModalVisible: boolean;
  friendRequetsModalTab: UserFriendModalTab | null;
}

const initialState: UserDetailsState = {
  userDetails: null,
  profileBackground: null,
  friendRequests: [],
  isFriendsModalVisible: false,
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
    setFriendRequests: (state, action: PayloadAction<FriendRequest[]>) => {
      state.friendRequests = action.payload;
    },
    setFriendsModalVisible: (
      state,
      action: PayloadAction<UserFriendModalTab>
    ) => {
      state.isFriendsModalVisible = true;
      state.friendRequetsModalTab = action.payload;
    },
    setFriendsModalHidden: (state) => {
      state.isFriendsModalVisible = false;
      state.friendRequetsModalTab = null;
    },
  },
});

export const {
  setUserDetails,
  setProfileBackground,
  setFriendRequests,
  setFriendsModalVisible,
  setFriendsModalHidden,
} = userDetailsSlice.actions;
