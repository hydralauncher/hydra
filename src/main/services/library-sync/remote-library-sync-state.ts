import { WindowManager } from "../window-manager";

let activeRemoteLibrarySyncs = 0;

export const isRemoteLibrarySyncing = () => activeRemoteLibrarySyncs > 0;

export const trackRemoteLibrarySync = async <T>(
  task: () => Promise<T>
): Promise<T> => {
  activeRemoteLibrarySyncs += 1;

  if (activeRemoteLibrarySyncs === 1) {
    WindowManager.sendToAppWindows("on-remote-library-sync-state", true);
  }

  try {
    return await task();
  } finally {
    activeRemoteLibrarySyncs -= 1;

    if (activeRemoteLibrarySyncs === 0) {
      WindowManager.sendToAppWindows("on-remote-library-sync-state", false);
    }
  }
};
