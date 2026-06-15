import { PayloadAction, createSlice } from "@reduxjs/toolkit";
import type { EmulatorSystem } from "@types";

type ScanPhase = "scanning" | "matching" | "done";

export interface ClassicsScanResult {
  fileCount: number;
  sizeBytes: number;
  matched: number;
  unmatched: number;
  unmatchedFiles: { name: string; reason: "wrong_platform" | "unmatched" }[];
}

export interface ClassicsScanState {
  active: boolean;
  modalVisible: boolean;
  requestId: string | null;
  system: EmulatorSystem | null;
  phase: ScanPhase;
  processed: number;
  total: number;
  percent: number;
  currentFile: string | null;
  status: "matched" | "wrong_platform" | "unmatched" | null;
  discovered: number;
  matched: number;
  sizeBytes: number;
  result: ClassicsScanResult | null;
  error: string | null;
  completedSystem: EmulatorSystem | null;
  completedNonce: number;
}

const baseState = {
  active: false,
  modalVisible: false,
  requestId: null,
  system: null,
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

const initialState: ClassicsScanState = {
  ...baseState,
  completedSystem: null,
  completedNonce: 0,
};

interface ProgressPayload {
  requestId: string;
  system: EmulatorSystem;
  phase: "scanning" | "matching";
  processed: number;
  total: number;
  percent: number;
  currentFile: string | null;
  status: "matched" | "wrong_platform" | "unmatched" | null;
  discovered: number;
  matched: number;
  sizeBytes: number;
}

interface SnapshotPayload {
  requestId: string;
  system: EmulatorSystem;
  phase: ScanPhase;
  processed: number;
  total: number;
  percent: number;
  currentFile: string | null;
  status: "matched" | "wrong_platform" | "unmatched" | null;
  discovered: number;
  matched: number;
  sizeBytes: number;
}

export const classicsScanSlice = createSlice({
  name: "classics-scan",
  initialState,
  reducers: {
    startClassicsScan: (
      state,
      action: PayloadAction<{
        requestId: string;
        system: EmulatorSystem;
        openModal: boolean;
      }>
    ) => {
      Object.assign(state, baseState);
      state.active = true;
      state.modalVisible = action.payload.openModal;
      state.requestId = action.payload.requestId;
      state.system = action.payload.system;
    },
    hydrateClassicsScan: (
      state,
      action: PayloadAction<SnapshotPayload | null>
    ) => {
      const snap = action.payload;
      if (!snap) return;
      state.active = true;
      state.requestId = snap.requestId;
      state.system = snap.system;
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
    updateClassicsScanProgress: (
      state,
      action: PayloadAction<ProgressPayload>
    ) => {
      const p = action.payload;
      state.active = true;
      state.requestId = p.requestId;
      state.system = p.system;
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
    finishClassicsScan: (
      state,
      action: PayloadAction<{
        cancelled: boolean;
        system: EmulatorSystem;
        result: ClassicsScanResult;
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
        state.completedSystem = action.payload.system;
        state.completedNonce += 1;
      } else {
        state.modalVisible = false;
        Object.assign(state, baseState);
      }
    },
    failClassicsScan: (state, action: PayloadAction<string>) => {
      state.active = false;
      state.error = action.payload;
      state.modalVisible = false;
      const { completedSystem, completedNonce } = state;
      Object.assign(state, baseState);
      state.completedSystem = completedSystem;
      state.completedNonce = completedNonce;
      state.error = action.payload;
    },
    openClassicsScanModal: (state) => {
      if (state.system) state.modalVisible = true;
    },
    closeClassicsScanModal: (state) => {
      state.modalVisible = false;
      if (!state.active) {
        const { completedSystem, completedNonce } = state;
        Object.assign(state, baseState);
        state.completedSystem = completedSystem;
        state.completedNonce = completedNonce;
      }
    },
  },
});

export const {
  startClassicsScan,
  hydrateClassicsScan,
  updateClassicsScanProgress,
  finishClassicsScan,
  failClassicsScan,
  openClassicsScanModal,
  closeClassicsScanModal,
} = classicsScanSlice.actions;
