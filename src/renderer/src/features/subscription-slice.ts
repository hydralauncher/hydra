import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { HydraCloudFeature } from "@types";

export interface SubscriptionState {
  isHydraCloudModalVisible: boolean;
  feature: HydraCloudFeature | "";
}

const initialState: SubscriptionState = {
  isHydraCloudModalVisible: false,
  feature: "",
};

export const subscriptionSlice = createSlice({
  name: "subscription",
  initialState,
  reducers: {
    setHydraCloudModalVisible: (
      state,
      action: PayloadAction<HydraCloudFeature>
    ) => {
      state.isHydraCloudModalVisible = true;
      state.feature = action.payload;
    },
    setHydraCloudModalHidden: (state) => {
      state.isHydraCloudModalVisible = false;
    },
  },
});

export const { setHydraCloudModalVisible, setHydraCloudModalHidden } =
  subscriptionSlice.actions;
