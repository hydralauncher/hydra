import { create } from "zustand";
import type { DownloadSourceImportResult } from "@types";

interface DownloadSourceTransferState {
  activeTransfer: "import" | "export" | null;
  importResult: DownloadSourceImportResult | null;
  setActiveTransfer: (activeTransfer: "import" | "export" | null) => void;
  setImportResult: (importResult: DownloadSourceImportResult | null) => void;
}

// Keep in-flight transfers and their results when the settings page unmounts.
export const useDownloadSourceTransferStore =
  create<DownloadSourceTransferState>((set) => ({
    activeTransfer: null,
    importResult: null,
    setActiveTransfer: (activeTransfer) => set({ activeTransfer }),
    setImportResult: (importResult) => set({ importResult }),
  }));
