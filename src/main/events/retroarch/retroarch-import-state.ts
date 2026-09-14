export interface RetroArchImportSnapshot {
  requestId: string;
  phase: "scanning" | "matching" | "done";
  processed: number;
  total: number;
  percent: number;
  currentFile: string | null;
  status: "matched" | "unmatched" | null;
  discovered: number;
  matched: number;
  sizeBytes: number;
}

let active: RetroArchImportSnapshot | null = null;

export const setActiveRetroArchImport = (
  snapshot: RetroArchImportSnapshot | null
) => {
  active = snapshot;
};

export const updateActiveRetroArchImport = (
  patch: Partial<RetroArchImportSnapshot>
) => {
  if (active) active = { ...active, ...patch };
};

export const getActiveRetroArchImport = (): RetroArchImportSnapshot | null =>
  active;
