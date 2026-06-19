import { useCallback, useState } from "react";
import type { LibraryGame } from "@types";
import { logger } from "@renderer/logger";
import type { BigPictureToastOptions } from "../../../stores";
import { IS_DESKTOP } from "../../../constants";

export interface PendingAction {
  type: "remove-files" | "remove-from-library";
  game: LibraryGame;
  restoreFocusId: string | null;
}

interface UseLibraryPendingActionOptions {
  getRestoreFocusId: () => string | null;
  onDataRefresh: () => Promise<void>;
  setFocus?: (id: string) => void;
  showSuccessToast?: (title: string, options?: BigPictureToastOptions) => void;
  buildToastOptions?: (
    game: LibraryGame,
    action: "removed"
  ) => Promise<{ title: string } & BigPictureToastOptions>;
  fallbackFocusId?: string;
  restoreFocusOnClose?: boolean;
  restoreFocusOnConfirm?: boolean;
}

function restoreFocus(id: string, setFocus?: (id: string) => void) {
  if (!setFocus) {
    return;
  }

  globalThis.window.requestAnimationFrame(() => {
    setFocus(id);
  });
}

function isDownloadCancellationRequired(game: LibraryGame) {
  return (
    game.download?.status === "active" ||
    game.download?.status === "extracting" ||
    game.download?.extracting
  );
}

async function stopGameActivity(action: PendingAction) {
  const { game, type } = action;

  if (isDownloadCancellationRequired(game)) {
    await globalThis.window.electron.cancelGameDownload(
      game.shop,
      game.objectId
    );
    return;
  }

  if (type === "remove-files" && game.download?.status === "seeding") {
    await globalThis.window.electron.pauseGameSeed(game.shop, game.objectId);
  }
}

async function executePendingAction(action: PendingAction) {
  const { game, type } = action;

  if (type === "remove-files") {
    await globalThis.window.electron.deleteGameFolder(game.shop, game.objectId);
    return;
  }

  await globalThis.window.electron.removeGameFromLibrary(
    game.shop,
    game.objectId
  );
}

function getRestoreFocusTarget(
  action: PendingAction,
  fallbackFocusId?: string
) {
  if (action.type === "remove-from-library") {
    return fallbackFocusId ?? null;
  }

  return action.restoreFocusId ?? fallbackFocusId ?? null;
}

async function showRemoveFromLibraryToast(
  action: PendingAction,
  buildToastOptions:
    | UseLibraryPendingActionOptions["buildToastOptions"]
    | undefined,
  showSuccessToast:
    | UseLibraryPendingActionOptions["showSuccessToast"]
    | undefined
) {
  if (action.type !== "remove-from-library") {
    return;
  }

  const { game } = action;
  const { title, ...toastOptions } = buildToastOptions
    ? await buildToastOptions(game, "removed")
    : { title: `${game.title} removed from library` };

  showSuccessToast?.(title, toastOptions);
}

export function useLibraryPendingAction({
  getRestoreFocusId,
  onDataRefresh,
  setFocus,
  showSuccessToast,
  buildToastOptions,
  fallbackFocusId,
  restoreFocusOnClose = true,
  restoreFocusOnConfirm = true,
}: UseLibraryPendingActionOptions) {
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null
  );
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);

  const requestRemoveFiles = useCallback(
    (game: LibraryGame) => {
      setPendingAction({
        type: "remove-files",
        game,
        restoreFocusId: getRestoreFocusId(),
      });
    },
    [getRestoreFocusId]
  );

  const requestRemoveFromLibrary = useCallback(
    (game: LibraryGame) => {
      setPendingAction({
        type: "remove-from-library",
        game,
        restoreFocusId: getRestoreFocusId(),
      });
    },
    [getRestoreFocusId]
  );

  const closePendingAction = useCallback(() => {
    const id = pendingAction?.restoreFocusId ?? null;

    setPendingAction(null);
    setIsSubmittingAction(false);

    if (id && restoreFocusOnClose) {
      restoreFocus(id, setFocus);
    }
  }, [pendingAction?.restoreFocusId, restoreFocusOnClose, setFocus]);

  const confirmPendingAction = useCallback(async () => {
    const currentAction = pendingAction;

    if (!currentAction || !IS_DESKTOP) return;

    setIsSubmittingAction(true);

    try {
      await stopGameActivity(currentAction);
      await executePendingAction(currentAction);

      await onDataRefresh();
      await showRemoveFromLibraryToast(
        currentAction,
        buildToastOptions,
        showSuccessToast
      );

      setPendingAction(null);
      setIsSubmittingAction(false);

      if (restoreFocusOnConfirm) {
        const id = getRestoreFocusTarget(currentAction, fallbackFocusId);

        if (id) {
          restoreFocus(id, setFocus);
        }
      }
    } catch (error) {
      logger.error("Failed to execute library action", error);
      setIsSubmittingAction(false);
    }
  }, [
    pendingAction,
    onDataRefresh,
    setFocus,
    showSuccessToast,
    buildToastOptions,
    fallbackFocusId,
    restoreFocusOnConfirm,
  ]);

  return {
    pendingAction,
    isSubmittingAction,
    requestRemoveFiles,
    requestRemoveFromLibrary,
    closePendingAction,
    confirmPendingAction,
  };
}
