import { useCallback } from "react";
import i18n from "i18next";

import type { EmulatorSystem } from "@types";

import { useAppDispatch, useAppSelector } from "./redux";
import {
  closeClassicsScanModal,
  openClassicsScanModal,
  startClassicsScan,
} from "@renderer/features";

interface ScanFolderInput {
  path: string;
  scanSubfolders: boolean;
}

export function useClassicsScan() {
  const dispatch = useAppDispatch();
  const scan = useAppSelector((state) => state.classicsScan);

  const start = useCallback(
    async (
      system: EmulatorSystem,
      folders: ScanFolderInput[],
      options?: { openModal?: boolean }
    ) => {
      const language = i18n.language.split("-")[0] || "en";
      const { requestId } = await window.electron.importLaunchboxRoms(
        system,
        folders.map((f) => ({
          path: f.path,
          scanSubfolders: f.scanSubfolders,
        })),
        language
      );
      dispatch(
        startClassicsScan({
          requestId,
          system,
          openModal: options?.openModal ?? false,
        })
      );
    },
    [dispatch]
  );

  const openModal = useCallback(
    () => dispatch(openClassicsScanModal()),
    [dispatch]
  );

  const closeModal = useCallback(
    () => dispatch(closeClassicsScanModal()),
    [dispatch]
  );

  const cancel = useCallback(() => {
    if (scan.requestId) {
      window.electron.cancelLaunchboxImport(scan.requestId);
    }
  }, [scan.requestId]);

  return { scan, start, openModal, closeModal, cancel };
}
