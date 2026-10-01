import { PayloadAction, createSlice } from "@reduxjs/toolkit";
import type { GameShop } from "@types";

export interface StreamingSession {
  /** Session state ("launching", "streaming", …) or the event name. */
  state: string;
  shop: GameShop;
  objectId: string;
  width?: number;
  height?: number;
  fps?: number;
}

export interface StreamingSessionState {
  streamingSession: StreamingSession | null;
}

const initialState: StreamingSessionState = {
  streamingSession: null,
};

export const streamingSessionSlice = createSlice({
  name: "streaming-session",
  initialState,
  reducers: {
    setStreamingSession: (
      state,
      action: PayloadAction<StreamingSession | null>
    ) => {
      state.streamingSession = action.payload;
    },
  },
});

export const { setStreamingSession } = streamingSessionSlice.actions;
