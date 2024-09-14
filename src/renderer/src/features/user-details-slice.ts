import { PayloadAction, createSlice } from "@reduxjs/toolkit";
import { UserFriendModalTab } from "@renderer/pages/shared-modals/user-friend-modal";
import type { FriendRequest, UserProfile } from "@types";

export interface UserDetailsState {
  userDetails: UserProfile | null;
  profileBackground: null | string;
  friendRequests: FriendRequest[];
  isFriendsModalVisible: boolean;
  friendRequetsModalTab: UserFriendModalTab | null;
  friendModalUserId: string;
}

const initialState: UserDetailsState = {
  userDetails: null,
  profileBackground: null,
  friendRequests: [],
  isFriendsModalVisible: false,
  friendRequetsModalTab: null,
  friendModalUserId: "",
};

export const userDetailsSlice = createSlice({
  name: "user-details",
  initialState,
  reducers: {
    setUserDetails: (state, action: PayloadAction<UserProfile | null>) => {
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
  setFriendsModalVisible,
  setFriendsModalHidden,
} = userDetailsSlice.actions;
