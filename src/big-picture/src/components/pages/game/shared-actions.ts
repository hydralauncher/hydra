import type { LibraryGame } from "@types";

type ToastOptions = {
  message?: string;
};

export type ClassicsDiscUpdatePayload = Parameters<
  typeof globalThis.window.electron.updateClassicsDisc
>[2];

interface GameIdentity {
  shop: LibraryGame["shop"];
  objectId: LibraryGame["objectId"];
}

interface ExecuteSteamShortcutActionParams {
  action: () => Promise<void>;
  setLoading: (loading: boolean) => void;
  setExists: (exists: boolean) => void;
  nextExists: boolean;
  updateGame: () => Promise<void>;
  showSuccessToast: (title: string, options?: ToastOptions) => void;
  showErrorToast: (title: string) => void;
  successMessage: string;
  errorMessage: string;
  restartMessage: string;
}

export async function executeSteamShortcutAction({
  action,
  setLoading,
  setExists,
  nextExists,
  updateGame,
  showSuccessToast,
  showErrorToast,
  successMessage,
  errorMessage,
  restartMessage,
}: Readonly<ExecuteSteamShortcutActionParams>) {
  try {
    setLoading(true);
    await action();
    showSuccessToast(successMessage, {
      message: restartMessage,
    });
    setExists(nextExists);
    await updateGame();
  } catch {
    showErrorToast(errorMessage);
  } finally {
    setLoading(false);
  }
}

export async function applyClassicsDiscUpdate(
  game: GameIdentity,
  payload: ClassicsDiscUpdatePayload,
  updateGame: () => Promise<void>,
  options?: { skipRefresh?: boolean }
) {
  await globalThis.window.electron.updateClassicsDisc(
    game.shop,
    game.objectId,
    payload
  );

  if (!options?.skipRefresh) {
    await updateGame();
  }
}

export function buildAddedDiscPayload(fullPath: string, discCount: number) {
  const fileName = fullPath.split(/[\\/]/).pop() ?? fullPath;
  const nextIndex = discCount + 1;

  return {
    addDisc: {
      path: fullPath,
      label: `Disc ${nextIndex}`,
      fileName,
    },
    selectedDiscPath: fullPath,
  } satisfies ClassicsDiscUpdatePayload;
}
