import { useCallback, useState } from "react";

import type { PendingFolder } from "./types";

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

  const handleAddFolder = useCallback(async () => {
    const result = await window.electron.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return;
    const folderPath = result.filePaths[0];

    let alreadyAdded = false;
    setFolders((prev) => {
      if (prev.some((f) => f.path === folderPath)) {
        alreadyAdded = true;
        return prev;
      }
      return [
        ...prev,
        { path: folderPath, scanSubfolders: true, previewCount: null },
      ];
    });
    if (alreadyAdded) return;

    onFolderAdded?.(folderPath);

    const count = await previewFolder(folderPath, true);
    setFolders((prev) =>
      prev.map((f) =>
        f.path === folderPath ? { ...f, previewCount: count } : f
      )
    );
  }, [previewFolder, onFolderAdded]);

  const handleChangeFolder = useCallback(
    async (index: number) => {
      const result = await window.electron.showOpenDialog({
        properties: ["openDirectory"],
      });
      if (result.canceled || result.filePaths.length === 0) return;
      const newPath = result.filePaths[0];

      let scanSubfolders = true;
      setFolders((prev) => {
        scanSubfolders = prev[index]?.scanSubfolders ?? true;
        return prev.map((f, i) =>
          i === index ? { ...f, path: newPath, previewCount: null } : f
        );
      });

      const count = await previewFolder(newPath, scanSubfolders);
      setFolders((prev) =>
        prev.map((f, i) => (i === index ? { ...f, previewCount: count } : f))
      );
    },
    [previewFolder]
  );

  const handleRemoveFolder = useCallback((index: number) => {
    setFolders((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleToggleSubfolders = useCallback(
    async (index: number) => {
      let folderPath: string | null = null;
      let next = true;
      setFolders((prev) => {
        const folder = prev[index];
        if (!folder) return prev;
        folderPath = folder.path;
        next = !folder.scanSubfolders;
        return prev.map((f, i) =>
          i === index ? { ...f, scanSubfolders: next, previewCount: null } : f
        );
      });
      if (folderPath === null) return;

      const count = await previewFolder(folderPath, next);
      setFolders((prev) =>
        prev.map((f, i) => (i === index ? { ...f, previewCount: count } : f))
      );
    },
    [previewFolder]
  );

  return {
    folders,
    setFolders,
    handleAddFolder,
    handleChangeFolder,
    handleRemoveFolder,
    handleToggleSubfolders,
  };
}
