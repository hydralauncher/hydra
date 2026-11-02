import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LibraryGame } from "@types";
import {
  getLibraryGameMembers,
  getOfficialStoreMembers,
  getRemoveFilesTarget,
  isSameRemoveFilesTarget,
  type RemoveFilesTarget,
} from "@shared";
import {
  getSteamLibraryExecutableCheckKey,
  useIsSteamLibraryExecutable,
} from "./use-steam-library-executable";
import { useToast } from "./use-toast";

interface UseSteamUninstallActionOptions {
  onSuccess?: () => void;
  onTargetChanged?: () => void;
}

export function useSteamUninstallAction(
  game: LibraryGame | null | undefined,
  enabled: boolean,
  options: UseSteamUninstallActionOptions = {}
) {
  const { t } = useTranslation("game_details");
  const { showSuccessToast, showErrorToast } = useToast();
  const [isUninstalling, setIsUninstalling] = useState(false);
  const onSuccessRef = useRef(options.onSuccess);
  const onTargetChangedRef = useRef(options.onTargetChanged);
  onSuccessRef.current = options.onSuccess;
  onTargetChangedRef.current = options.onTargetChanged;

  const steamUninstallAvailable =
    typeof globalThis.window.electron.uninstallGameOnSteam === "function";
  const steamMember = game
    ? getOfficialStoreMembers(getLibraryGameMembers(game)).steam
    : null;
  const checkKey = getSteamLibraryExecutableCheckKey(
    steamMember,
    enabled && steamUninstallAvailable
  );
  const isSteamLibraryExecutable = useIsSteamLibraryExecutable(
    steamMember,
    enabled && steamUninstallAvailable
  );
  const resolvedTarget =
    enabled && game
      ? getRemoveFilesTarget(
          game,
          steamUninstallAvailable,
          isSteamLibraryExecutable === true
        )
      : null;
  const steamUninstallTarget =
    resolvedTarget?.kind === "steam" ? resolvedTarget : null;
  const isSteamProbePending = Boolean(
    checkKey && isSteamLibraryExecutable === null
  );

  const handleSteamUninstall = useCallback(
    async (target: RemoveFilesTarget) => {
      const liveTarget = game
        ? getRemoveFilesTarget(
            game,
            steamUninstallAvailable,
            isSteamLibraryExecutable === true
          )
        : null;

      if (
        liveTarget?.kind !== "steam" ||
        !isSameRemoveFilesTarget(liveTarget, target)
      ) {
        showErrorToast(t("remove_files_target_changed"));
        onTargetChangedRef.current?.();
        return;
      }

      setIsUninstalling(true);
      try {
        await globalThis.window.electron.uninstallGameOnSteam?.(
          liveTarget.appId
        );
        showSuccessToast(
          t("steam_uninstall_requested"),
          t("steam_uninstall_requested_description")
        );
        onSuccessRef.current?.();
      } catch {
        showErrorToast(t("steam_uninstall_failed"));
      } finally {
        setIsUninstalling(false);
      }
    },
    [
      game,
      steamUninstallAvailable,
      isSteamLibraryExecutable,
      showSuccessToast,
      showErrorToast,
      t,
    ]
  );

  return {
    steamUninstallTarget,
    isSteamProbePending,
    isUninstalling,
    handleSteamUninstall,
  };
}
