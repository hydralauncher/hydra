import { useCallback } from "react";
import i18n from "i18next";

import { useAppDispatch, useAppSelector } from "./redux";
import {
  closeRetroArchScanModal,
  openRetroArchScanModal,
  resetRetroArchScan,
  startRetroArchScan,
} from "@renderer/features";

interface ScanFolderInput {
  path: string;
  scanSubfolders: boolean;
}

export function useRetroArchScan() {
  const dispatch = useAppDispatch();
  const scan = useAppSelector((state) => state.retroarchScan);

  const start = useCallback(
    async (folders: ScanFolderInput[], options?: { openModal?: boolean }) => {
      if (scan.active) return;
      const language = i18n.language.split("-")[0] || "en";
      const { requestId } = await window.electron.importRetroArchRoms(
        folders.map((f) => ({
          path: f.path,
          scanSubfolders: f.scanSubfolders,
        })),
        language
      );
      dispatch(
        startRetroArchScan({
          requestId,
          openModal: options?.openModal ?? false,
        })
      );
    },
    [dispatch, scan.active]
  );

  const openModal = useCallback(() => {
    dispatch(openRetroArchScanModal());
  }, [dispatch]);

  const closeModal = useCallback(() => {
    dispatch(closeRetroArchScanModal());
  }, [dispatch]);

  const cancel = useCallback(() => {
    if (scan.requestId) {
      window.electron.cancelRetroArchImport(scan.requestId);
    }
  }, [scan.requestId]);

  const reset = useCallback(() => {
    if (!scan.active) dispatch(resetRetroArchScan());
  }, [dispatch, scan.active]);

  return { scan, start, openModal, closeModal, cancel, reset };
}
