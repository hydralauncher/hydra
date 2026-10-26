import type { GameShop } from "@types";
import { getGameExecutableFilters } from "@shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { logger } from "@renderer/logger";
import { useBigPictureToast } from "../../../hooks";
import { FileExplorerModal } from "../../common";

export interface ExecutablePickerTarget {
  shop: GameShop;
  objectId: string;
}

interface ExecutablePickerModalProps {
  target: ExecutablePickerTarget | null;
  onClose: () => void;
  onSaved?: () => void;
}

const getInitialPath = async (target: ExecutablePickerTarget) => {
  const gameFolderPath = await globalThis.window.electron
    .getExecutablePickerPath(target.shop, target.objectId)
    .catch(() => null);

  if (gameFolderPath) return gameFolderPath;

  const userPreferences = await globalThis.window.electron
    .getUserPreferences()
    .catch(() => null);

  return (
    userPreferences?.downloadsPath ??
    (await globalThis.window.electron.getDefaultDownloadsPath().catch(() => ""))
  );
};

export function ExecutablePickerModal({
  target,
  onClose,
  onSaved,
}: Readonly<ExecutablePickerModalProps>) {
  const { t } = useTranslation("game_details");
  const { showErrorToast } = useBigPictureToast();
  const [resolvedPath, setResolvedPath] = useState<{
    key: string;
    path: string;
  } | null>(null);
  const targetKey = target ? `${target.shop}:${target.objectId}` : null;

  const filters = useMemo(
    () =>
      getGameExecutableFilters(globalThis.window.electron.platform, {
        executable: t("game_executable"),
        allFiles: t("all_files"),
      }),
    [t]
  );

  useEffect(() => {
    if (!target) return;

    let cancelled = false;

    const key = `${target.shop}:${target.objectId}`;

    void getInitialPath(target).then((path) => {
      if (!cancelled) setResolvedPath({ key, path });
    });

    return () => {
      cancelled = true;
    };
  }, [target]);

  const handleSelect = useCallback(
    async (executablePath: string) => {
      if (!target) return;

      onClose();

      try {
        const gameUsingPath =
          await globalThis.window.electron.verifyExecutablePathInUse(
            executablePath
          );

        if (
          gameUsingPath &&
          (gameUsingPath.objectId !== target.objectId ||
            gameUsingPath.shop !== target.shop)
        ) {
          showErrorToast(
            t("executable_path_in_use", { game: gameUsingPath.title })
          );
          return;
        }

        await globalThis.window.electron.updateExecutablePath(
          target.shop,
          target.objectId,
          executablePath
        );
        globalThis.window.dispatchEvent(new Event("library-update"));
        onSaved?.();
      } catch (error) {
        logger.error("Failed to save the selected executable", error);
      }
    },
    [onClose, onSaved, showErrorToast, t, target]
  );

  return (
    <FileExplorerModal
      visible={target !== null && resolvedPath?.key === targetKey}
      onClose={onClose}
      onSelect={(executablePath) => void handleSelect(executablePath)}
      title={t("select_executable", { ns: "downloads" })}
      initialPath={resolvedPath?.path ?? ""}
      filters={filters}
    />
  );
}
