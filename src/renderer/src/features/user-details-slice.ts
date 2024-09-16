import { PayloadAction, createSlice } from "@reduxjs/toolkit";
import { UserFriendModalTab } from "@renderer/pages/shared-modals/user-friend-modal";
import type { FriendRequest, UserDetails } from "@types";

export interface UserDetailsState {
  userDetails: UserDetails | null;
  profileBackground: null | string;
  friendRequests: FriendRequest[];
  FriendRequestCount: number;
  isFriendsModalVisible: boolean;
  friendRequetsModalTab: UserFriendModalTab | null;
  friendModalUserId: string;
}

const initialState: UserDetailsState = {
  userDetails: null,
  profileBackground: null,
  friendRequests: [],
  FriendRequestCount: 0,
  isFriendsModalVisible: false,
  friendRequetsModalTab: null,
  friendModalUserId: "",
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
      state.FriendRequestCount = action.payload;
    },
    setFriendsModalVisible: (
      state,
      action: PayloadAction<{ initialTab: UserFriendModalTab; userId: string }>
    ) => {
      state.isFriendsModalVisible = true;
      state.friendRequetsModalTab = action.payload.initialTab;
      state.friendModalUserId = action.payload.userId;
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
  setFriendRequestCount,
  setFriendsModalVisible,
  setFriendsModalHidden,
} = userDetailsSlice.actions;
