import { useCallback, useRef, useState } from "react";

import type { PendingFolder } from "./types";
import {
  applyPendingFolderPreview,
  preparePendingFolderPreview,
  type PendingFolderPreviewRequest,
} from "./pending-rom-folder-preview";

interface UsePendingRomFoldersOptions {
  previewFolder: (
    folderPath: string,
    scanSubfolders: boolean
  ) => Promise<number | null>;
  onFolderAdded?: (folderPath: string) => void;
}

export function usePendingRomFolders({
  previewFolder,
  onFolderAdded,
}: UsePendingRomFoldersOptions) {
  const [folders, setFolders] = useState<PendingFolder[]>([]);
  const foldersRef = useRef<PendingFolder[]>([]);
  const nextPreviewRequestIdRef = useRef(1);

  const updateFolders = useCallback(
    (update: (current: PendingFolder[]) => PendingFolder[]) => {
      const next = update(foldersRef.current);
      foldersRef.current = next;
      setFolders(next);
    },
    []
  );

  const replaceFolders = useCallback((next: PendingFolder[]) => {
    foldersRef.current = next;
    setFolders(next);
  }, []);

  const runPreview = useCallback(
    async (request: PendingFolderPreviewRequest) => {
      const count = await previewFolder(request.path, request.scanSubfolders);
      updateFolders((current) =>
        applyPendingFolderPreview(current, request, count)
      );
    },
    [previewFolder, updateFolders]
  );

  const refreshFolderPreview = useCallback(
    async (index: number) => {
      const prepared = preparePendingFolderPreview(
        foldersRef.current,
        index,
        nextPreviewRequestIdRef.current++
      );
      if (!prepared) return;

      replaceFolders(prepared.folders);
      await runPreview(prepared.request);
    },
    [replaceFolders, runPreview]
  );

  const handleAddFolder = useCallback(async () => {
    const result = await window.electron.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return;
    const folderPath = result.filePaths[0];

    if (foldersRef.current.some((folder) => folder.path === folderPath)) return;

    const requestId = nextPreviewRequestIdRef.current++;
    const request: PendingFolderPreviewRequest = {
      path: folderPath,
      scanSubfolders: true,
      requestId,
    };
    updateFolders((current) => [
      ...current,
      {
        path: folderPath,
        scanSubfolders: true,
        previewCount: null,
        previewRequestId: requestId,
      },
    ]);

    onFolderAdded?.(folderPath);
    await runPreview(request);
  }, [onFolderAdded, runPreview, updateFolders]);

  const handleChangeFolder = useCallback(
    async (index: number) => {
      const result = await window.electron.showOpenDialog({
        properties: ["openDirectory"],
      });
      if (result.canceled || result.filePaths.length === 0) return;
      const newPath = result.filePaths[0];

      const prepared = preparePendingFolderPreview(
        foldersRef.current,
        index,
        nextPreviewRequestIdRef.current++,
        { path: newPath }
      );
      if (!prepared) return;

      replaceFolders(prepared.folders);
      await runPreview(prepared.request);
    },
    [replaceFolders, runPreview]
  );

  const handleRemoveFolder = useCallback(
    (index: number) => {
      updateFolders((current) =>
        current.filter((_, folderIndex) => folderIndex !== index)
      );
    },
    [updateFolders]
  );

  const handleToggleSubfolders = useCallback(
    async (index: number) => {
      const current = foldersRef.current[index];
      if (!current) return;

      const prepared = preparePendingFolderPreview(
        foldersRef.current,
        index,
        nextPreviewRequestIdRef.current++,
        { scanSubfolders: !current.scanSubfolders }
      );
      if (!prepared) return;

      replaceFolders(prepared.folders);
      await runPreview(prepared.request);
    },
    [replaceFolders, runPreview]
  );

  return {
    folders,
    setFolders: replaceFolders,
    handleAddFolder,
    handleChangeFolder,
    handleRemoveFolder,
    handleToggleSubfolders,
    refreshFolderPreview,
  };
}
