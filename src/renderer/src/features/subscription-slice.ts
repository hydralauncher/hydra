import { createSlice } from "@reduxjs/toolkit";

export interface SubscriptionState {
  isHydraCloudModalVisible: boolean;
}

const initialState: SubscriptionState = {
  isHydraCloudModalVisible: false,
};

export const subscriptionSlice = createSlice({
  name: "subscription",
  initialState,
  reducers: {
    setHydraCloudModalVisible: (state) => {
      state.isHydraCloudModalVisible = true;
    },
    setHydraCloudModalHidden: (state) => {
      state.isHydraCloudModalVisible = false;
    },
  },
});

export const { setHydraCloudModalVisible, setHydraCloudModalHidden } =
  subscriptionSlice.actions;
