import { useCallback } from "react";
import i18n from "i18next";

import { useAppDispatch, useAppSelector } from "./redux";
import { resetRetroArchScan, startRetroArchScan } from "@renderer/features";

interface ScanFolderInput {
  path: string;
  scanSubfolders: boolean;
}

export function useRetroArchScan() {
  const dispatch = useAppDispatch();
  const scan = useAppSelector((state) => state.retroarchScan);

  const start = useCallback(
    async (folders: ScanFolderInput[]) => {
      if (scan.active) return;
      const language = i18n.language.split("-")[0] || "en";
      const { requestId } = await window.electron.importRetroArchRoms(
        folders.map((f) => ({
          path: f.path,
          scanSubfolders: f.scanSubfolders,
        })),
        language
      );
      dispatch(startRetroArchScan({ requestId }));
    },
    [dispatch, scan.active]
  );

  const cancel = useCallback(() => {
    if (scan.requestId) {
      window.electron.cancelRetroArchImport(scan.requestId);
    }
  }, [scan.requestId]);

  const reset = useCallback(() => {
    if (!scan.active) dispatch(resetRetroArchScan());
  }, [dispatch, scan.active]);

  return { scan, start, cancel, reset };
}
