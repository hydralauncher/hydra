import { PayloadAction, createSlice } from "@reduxjs/toolkit";
import type { UserAuth } from "@types";

export interface UserAuthState {
  userAuth: UserAuth | null;
}

const initialState: UserAuthState = {
  userAuth: null,
};

export const userAuthSlice = createSlice({
  name: "user-auth",
  initialState,
  reducers: {
    setUserAuth: (state, userAuth: PayloadAction<UserAuth | null>) => {
      state.userAuth = userAuth.payload;
    },
  },
});

export const { setUserAuth } = userAuthSlice.actions;
