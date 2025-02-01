import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import { ToastProps } from "@renderer/components/toast/toast";

export interface ToastState {
  title: string;
  message?: string;
  type: ToastProps["type"];
  duration?: number;
  visible: boolean;
}

const initialState: ToastState = {
  title: "",
  message: "",
  type: "success",
  duration: 5000,
  visible: false,
};

export const toastSlice = createSlice({
  name: "toast",
  initialState,
  reducers: {
    showToast: (state, action: PayloadAction<Omit<ToastState, "visible">>) => {
      state.title = action.payload.title;
      state.message = action.payload.message;
      state.type = action.payload.type;
      state.duration = action.payload.duration ?? 5000;
      state.visible = true;
    },
    closeToast: (state) => {
      state.visible = false;
    },
  },
});

export const { showToast, closeToast } = toastSlice.actions;
