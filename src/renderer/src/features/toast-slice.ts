import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import { ToastProps } from "@renderer/components/toast/toast";

export interface ToastState {
  message: string;
  type: ToastProps["type"];
  visible: boolean;
}

const initialState: ToastState = {
  message: "",
  type: "success",
  visible: false,
};

export const toastSlice = createSlice({
  name: "toast",
  initialState,
  reducers: {
    showToast: (state, action: PayloadAction<Omit<ToastState, "visible">>) => {
      console.log(action.payload);
      state.message = action.payload.message;
      state.visible = true;
    },
    closeToast: (state) => {
      state.visible = false;
    },
  },
});

export const { showToast, closeToast } = toastSlice.actions;
