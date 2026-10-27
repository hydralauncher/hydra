import { useCallback, useEffect, useMemo, useState } from "react";
import { IS_DESKTOP } from "../constants";
import type { LibraryGame } from "@types";

type LibraryListener = (library: LibraryGame[]) => void;
type AccountLibraryListener = (isAwaiting: boolean) => void;

const ACCOUNT_LIBRARY_WAIT_TIMEOUT_MS = 30_000;

let cachedLibrary: LibraryGame[] | null = null;
let libraryRequest: Promise<void> | null = null;
let hasQueuedLibraryRequest = false;
const libraryListeners = new Set<LibraryListener>();
let isAwaitingAccountLibrary = false;
let accountLibraryTimeout: ReturnType<typeof setTimeout> | null = null;
const accountLibraryListeners = new Set<AccountLibraryListener>();

function setAwaitingAccountLibrary(isAwaiting: boolean) {
  if (accountLibraryTimeout !== null) {
    clearTimeout(accountLibraryTimeout);
    accountLibraryTimeout = null;
  }

  if (isAwaiting) {
    accountLibraryTimeout = setTimeout(
      () => setAwaitingAccountLibrary(false),
      ACCOUNT_LIBRARY_WAIT_TIMEOUT_MS
    );
  }

  if (isAwaitingAccountLibrary === isAwaiting) return;

  isAwaitingAccountLibrary = isAwaiting;
  accountLibraryListeners.forEach((listener) => listener(isAwaiting));
}

function requestLibrary(): Promise<void> {
  if (libraryRequest !== null) {
    hasQueuedLibraryRequest = true;
    return libraryRequest;
  }

  libraryRequest = globalThis.window.electron
    .getLibrary(true)
    .then((library) => {
      cachedLibrary = library;
      libraryListeners.forEach((listener) => listener(library));
    })
    .finally(() => {
      libraryRequest = null;

      if (hasQueuedLibraryRequest) {
        hasQueuedLibraryRequest = false;
        void requestLibrary();
      }
    });

  return libraryRequest;
}

export function useLibrary() {
  const [downloadLibrary, setDownloadLibrary] = useState<LibraryGame[]>(
    () => cachedLibrary ?? []
  );
  const [hasLoadedLibrary, setHasLoadedLibrary] = useState(
    () => cachedLibrary !== null || !IS_DESKTOP
  );
  const [isAwaitingAccount, setIsAwaitingAccount] = useState(
    isAwaitingAccountLibrary
  );
  const library = useMemo(
    () => downloadLibrary.filter((game) => !game.isConcealed),
    [downloadLibrary]
  );

  const updateLibrary = useCallback(async () => {
    if (!IS_DESKTOP) return;
    await requestLibrary();
  }, []);

  useEffect(() => {
    const handleLibrary: LibraryListener = (nextLibrary) => {
      setDownloadLibrary(nextLibrary);
      setHasLoadedLibrary(true);
    };

    libraryListeners.add(handleLibrary);
    accountLibraryListeners.add(setIsAwaitingAccount);
    if (cachedLibrary) handleLibrary(cachedLibrary);
    setIsAwaitingAccount(isAwaitingAccountLibrary);

    return () => {
      libraryListeners.delete(handleLibrary);
      accountLibraryListeners.delete(setIsAwaitingAccount);
    };
  }, []);

  useEffect(() => {
    updateLibrary();

    if (!IS_DESKTOP) return;

    const unsubscribeLibraryBatch =
      globalThis.window.electron.onLibraryBatchComplete(() => {
        setAwaitingAccountLibrary(false);
        updateLibrary();
      });

    const unsubscribeLibraryGames =
      globalThis.window.electron.onLibraryGamesUpdated(() => {
        updateLibrary();
      });

    const unsubscribeSignIn = globalThis.window.electron.onSignIn(() => {
      setAwaitingAccountLibrary(true);
    });

    const unsubscribeSignOut = globalThis.window.electron.onSignOut(() => {
      setAwaitingAccountLibrary(false);
    });

    const unsubscribeDownloadsUpdated =
      globalThis.window.electron.onDownloadsUpdated(() => {
        updateLibrary();
      });

    const handleLibraryUpdate = () => updateLibrary();
    globalThis.window.addEventListener("library-update", handleLibraryUpdate);

    return () => {
      unsubscribeLibraryBatch();
      unsubscribeLibraryGames();
      unsubscribeSignIn();
      unsubscribeSignOut();
      unsubscribeDownloadsUpdated();
      globalThis.window.removeEventListener(
        "library-update",
        handleLibraryUpdate
      );
    };
  }, [updateLibrary]);

  return {
    library,
    downloadLibrary,
    updateLibrary,
    hasLoadedLibrary,
    isAwaitingAccountLibrary: isAwaitingAccount,
  };
}
