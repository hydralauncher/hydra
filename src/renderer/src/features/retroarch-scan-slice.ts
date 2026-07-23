import { PayloadAction, createSlice } from "@reduxjs/toolkit";

type ScanPhase = "scanning" | "matching" | "done";
type ScanRowStatus = "matched" | "unmatched" | null;

export interface RetroArchScanResult {
  fileCount: number;
  sizeBytes: number;
  matched: number;
  unmatched: number;
  unmatchedFiles: { name: string; reason: "unmatched" }[];
}

export interface RetroArchScanState {
  active: boolean;
  requestId: string | null;
  phase: ScanPhase;
  processed: number;
  total: number;
  percent: number;
  currentFile: string | null;
  status: ScanRowStatus;
  discovered: number;
  matched: number;
  sizeBytes: number;
  result: RetroArchScanResult | null;
  error: string | null;
  completedNonce: number;
}

const baseState = {
  active: false,
  requestId: null,
  phase: "scanning" as ScanPhase,
  processed: 0,
  total: 0,
  percent: 0,
  currentFile: null,
  status: null,
  discovered: 0,
  matched: 0,
  sizeBytes: 0,
  result: null,
  error: null,
};

const initialState: RetroArchScanState = {
  ...baseState,
  completedNonce: 0,
};

interface ProgressPayload {
  requestId: string;
  phase: "scanning" | "matching";
  processed: number;
  total: number;
  percent: number;
  currentFile: string | null;
  status: ScanRowStatus;
  discovered: number;
  matched: number;
  sizeBytes: number;
}

interface SnapshotPayload {
  requestId: string;
  phase: ScanPhase;
  processed: number;
  total: number;
  percent: number;
  currentFile: string | null;
  status: ScanRowStatus;
  discovered: number;
  matched: number;
  sizeBytes: number;
}

export const retroarchScanSlice = createSlice({
  name: "retroarch-scan",
  initialState,
  reducers: {
    startRetroArchScan: (
      state,
      action: PayloadAction<{ requestId: string }>
    ) => {
      Object.assign(state, baseState);
      state.active = true;
      state.requestId = action.payload.requestId;
    },
    hydrateRetroArchScan: (
      state,
      action: PayloadAction<SnapshotPayload | null>
    ) => {
      const snap = action.payload;
      if (!snap) return;
      state.active = true;
      state.requestId = snap.requestId;
      state.phase = snap.phase;
      state.processed = snap.processed;
      state.total = snap.total;
      state.percent = snap.percent;
      state.currentFile = snap.currentFile;
      state.status = snap.status;
      state.discovered = snap.discovered;
      state.matched = snap.matched;
      state.sizeBytes = snap.sizeBytes;
      state.result = null;
      state.error = null;
    },
    updateRetroArchScanProgress: (
      state,
      action: PayloadAction<ProgressPayload>
    ) => {
      const p = action.payload;
      state.active = true;
      state.requestId = p.requestId;
      state.phase = p.phase;
      state.processed = p.processed;
      state.total = p.total;
      state.percent = p.percent;
      state.currentFile = p.currentFile;
      state.status = p.status;
      state.discovered = p.discovered;
      state.matched = p.matched;
      state.sizeBytes = p.sizeBytes;
    },
    finishRetroArchScan: (
      state,
      action: PayloadAction<{
        cancelled: boolean;
        result: RetroArchScanResult;
      }>
    ) => {
      state.active = false;
      state.phase = "done";
      state.percent = 100;
      state.currentFile = null;
      state.status = null;
      state.matched = action.payload.result.matched;
      state.sizeBytes = action.payload.result.sizeBytes;
      state.result = action.payload.result;
      if (!action.payload.cancelled) {
        state.completedNonce += 1;
      } else {
        Object.assign(state, baseState);
      }
    },
    failRetroArchScan: (state, action: PayloadAction<string>) => {
      state.active = false;
      const { completedNonce } = state;
      Object.assign(state, baseState);
      state.completedNonce = completedNonce;
      state.error = action.payload;
    },
    resetRetroArchScan: (state) => {
      const { completedNonce } = state;
      Object.assign(state, baseState);
      state.completedNonce = completedNonce;
    },
  },
});

export const {
  startRetroArchScan,
  hydrateRetroArchScan,
  updateRetroArchScanProgress,
  finishRetroArchScan,
  failRetroArchScan,
  resetRetroArchScan,
} = retroarchScanSlice.actions;
