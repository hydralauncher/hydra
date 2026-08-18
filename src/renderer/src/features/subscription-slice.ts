import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { MedusaCloudFeature } from "@types";

export interface SubscriptionState {
  isMedusaCloudModalVisible: boolean;
  feature: MedusaCloudFeature | "";
}

const initialState: SubscriptionState = {
  isMedusaCloudModalVisible: false,
  feature: "",
};

export const subscriptionSlice = createSlice({
  name: "subscription",
  initialState,
  reducers: {
    setMedusaCloudModalVisible: (
      state,
      action: PayloadAction<MedusaCloudFeature>
    ) => {
      state.isMedusaCloudModalVisible = true;
      state.feature = action.payload;
    },
    setMedusaCloudModalHidden: (state) => {
      state.isMedusaCloudModalVisible = false;
    },
  },
});

export const { setMedusaCloudModalVisible, setMedusaCloudModalHidden } =
  subscriptionSlice.actions;
