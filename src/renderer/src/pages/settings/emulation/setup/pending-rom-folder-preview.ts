import type { PendingFolder } from "./types";

export interface PendingFolderPreviewRequest {
  path: string;
  scanSubfolders: boolean;
  requestId: number;
}

export const preparePendingFolderPreview = (
  folders: PendingFolder[],
  index: number,
  requestId: number,
  changes: Partial<Pick<PendingFolder, "path" | "scanSubfolders">> = {}
): {
  folders: PendingFolder[];
  request: PendingFolderPreviewRequest;
} | null => {
  const current = folders[index];
  if (!current) return null;

  const pending = {
    ...current,
    ...changes,
    previewCount: null,
    previewRequestId: requestId,
  };

  return {
    folders: folders.map((folder, folderIndex) =>
      folderIndex === index ? pending : folder
    ),
    request: {
      path: pending.path,
      scanSubfolders: pending.scanSubfolders,
      requestId,
    },
  };
};

export const applyPendingFolderPreview = (
  folders: PendingFolder[],
  request: PendingFolderPreviewRequest,
  previewCount: number | null
): PendingFolder[] =>
  folders.map((folder) =>
    folder.path === request.path &&
    folder.scanSubfolders === request.scanSubfolders &&
    folder.previewRequestId === request.requestId
      ? { ...folder, previewCount }
      : folder
  );
