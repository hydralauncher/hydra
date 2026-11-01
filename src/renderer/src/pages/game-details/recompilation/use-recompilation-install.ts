import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { pickRecompilationAsset } from "@shared";
import type {
  RecompilationInstallProgress,
  RecompilationInstallState,
  RecompilationPort,
} from "@types";
import { useToast } from "@renderer/hooks";
import { logger } from "@renderer/logger";

export type RecompilationInstallStatus =
  | "idle"
  | "downloading"
  | "extracting"
  | "installed";

export function useRecompilationInstall(port: RecompilationPort) {
  const { t } = useTranslation("game_details");
  const { showSuccessToast, showErrorToast } = useToast();

  const [state, setState] = useState<RecompilationInstallState | null>(null);
  const [progress, setProgress] = useState<RecompilationInstallProgress | null>(
    null
  );

  const refresh = useCallback(async () => {
    try {
      setState(await window.electron.getRecompilationInstallState(port.id));
    } catch (error) {
      logger.error("Failed to read the recompilation install state", error);
    }
  }, [port.id]);

  useEffect(() => {
    setState(null);
    setProgress(null);
    refresh();
  }, [refresh]);

  useEffect(() => {
    return window.electron.onRecompilationInstallProgress((payload) => {
      if (payload.portId !== port.id) return;

      if (payload.phase === "done" || payload.phase === "error") {
        setProgress(null);
        refresh();
        return;
      }

      setProgress(payload);
    });
  }, [port.id, refresh]);

  const install = useCallback(async () => {
    setProgress({ portId: port.id, phase: "downloading", loaded: 0 });

    const result = await window.electron.installRecompilation(port.id);

    setProgress(null);
    await refresh();

    if (result.ok) {
      showSuccessToast(t("recompilation_install_success", { port: port.name }));
    } else if (result.reason !== "already_installing") {
      showErrorToast(t("recompilation_install_failed", { port: port.name }));
    }
  }, [port.id, port.name, refresh, showErrorToast, showSuccessToast, t]);

  const openFolder = useCallback(async () => {
    const error = await window.electron.openRecompilationFolder(port.id);
    if (error) showErrorToast(t("recompilation_open_folder_failed"));
  }, [port.id, showErrorToast, t]);

  // Main resolves the file from process.platform and process.arch. Until it
  // answers, assume x64, which is what every listed release targets.
  const asset = useMemo(() => {
    if (state) {
      return (
        port.release.assets.find((item) => item.name === state.assetName) ??
        null
      );
    }

    return pickRecompilationAsset(port, window.electron.platform, "x64");
  }, [port, state]);

  let status: RecompilationInstallStatus = "idle";
  if (progress?.phase === "extracting") status = "extracting";
  else if (progress || state?.isInstalling) status = "downloading";
  else if (state?.installed) status = "installed";

  return { status, progress, asset, install, openFolder };
}
