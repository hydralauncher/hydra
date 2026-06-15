import type { EmulatorSystem } from "@types";

export interface ClassicsImportSnapshot {
  requestId: string;
  system: EmulatorSystem;
  phase: "scanning" | "matching" | "done";
  processed: number;
  total: number;
  percent: number;
  currentFile: string | null;
  status: "matched" | "wrong_platform" | "unmatched" | null;
  discovered: number;
  matched: number;
  sizeBytes: number;
}

let active: ClassicsImportSnapshot | null = null;

export const setActiveClassicsImport = (
  snapshot: ClassicsImportSnapshot | null
) => {
  active = snapshot;
};

export const updateActiveClassicsImport = (
  patch: Partial<ClassicsImportSnapshot>
) => {
  if (active) active = { ...active, ...patch };
};

export const getActiveClassicsImport = (): ClassicsImportSnapshot | null =>
  active;

export const isClassicsImporting = () => active !== null;
